import { Fingerprint } from '../models/Fingerprint.js';
import { Paste } from '../models/Paste.js';
import { AppError } from '../lib/AppError.js';
import { logger } from '../lib/logger.js';
import { analyzeVariance } from '../fingerprint/variance.js';

/**
 * Records one occurrence of an error signature.
 *
 * A single atomic upsert: no read-modify-write, so concurrent occurrences of
 * the same error cannot lose an increment. $setOnInsert fills the immutable
 * fields only when the document is created; $max moves lastSeenAt forward and
 * never backwards, which matters if two writes land out of order.
 *
 * @param {import('../fingerprint/index.js').Fingerprinted} parsed
 */
export async function recordOccurrence(parsed, when = new Date()) {
  const update = {
    $inc: { count: 1 },
    $max: { lastSeenAt: when },
    $setOnInsert: {
      runtime: parsed.runtime,
      errorType: parsed.errorType,
      normalizedMessage: parsed.normalizedMessage,
      topFrame: parsed.topFrame,
      allFramesAreVendor: parsed.allFramesAreVendor,
      firstSeenAt: when,
    },
  };

  try {
    await Fingerprint.updateOne({ _id: parsed.fingerprint }, update, { upsert: true });
  } catch (err) {
    // Two upserts of a brand-new signature can race and collide on _id. The
    // document exists by the time we retry, so the $inc path applies.
    if (err.code === 11000) {
      await Fingerprint.updateOne({ _id: parsed.fingerprint }, update, { upsert: true });
      return;
    }
    throw err;
  }
}

export async function getFingerprint(hash) {
  const doc = await Fingerprint.findById(hash);
  if (!doc) throw AppError.notFound('No error group with that signature');
  return doc;
}

/**
 * The query the compound index exists for.
 *
 * { fingerprint: 1, createdAt: -1, _id: -1 } means Mongo seeks to the
 * fingerprint prefix and reads results already in order — no in-memory sort.
 */
export async function listOccurrences(hash, { cursor, limit = 20 } = {}) {
  const capped = Math.min(Math.max(limit, 1), 50);

  const filter = { fingerprint: hash };
  if (cursor) {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()) || !id) throw AppError.badRequest('That page cursor is not valid');
    filter.$or = [{ createdAt: { $lt: date } }, { createdAt: date, _id: { $lt: id } }];
  }

  const rows = await Paste.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(capped + 1)
    .select('slug title language createdAt views authorId');

  const hasMore = rows.length > capped;
  const items = hasMore ? rows.slice(0, capped) : rows;
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: hasMore
      ? Buffer.from(`${last.createdAt.toISOString()}|${last._id}`).toString('base64url')
      : null,
  };
}

/**
 * What these occurrences share, and exactly which parts of them differ.
 *
 * Capped at 200: variance stops telling you anything new long before that, and
 * an unbounded scan of a popular group is a slow query waiting to happen. The
 * query rides { fingerprint, createdAt, _id }, so it is the same index scan the
 * occurrence list uses.
 */
export async function getVariance(hash, sampleSize = 200) {
  const rows = await Paste.find({ fingerprint: hash })
    .sort({ createdAt: -1, _id: -1 })
    .limit(sampleSize)
    .select('parsed')
    .lean();

  const analysis = analyzeVariance(
    rows
      .map((r) => r.parsed)
      .filter(Boolean)
      .map((p) => ({
        message: p.message,
        normalizedMessage: p.normalizedMessage,
        frames: p.frames ?? [],
      }))
  );

  return { ...analysis, sampled: rows.length, capped: rows.length === sampleSize };
}

/**
 * Rebuilds every count from the pastes collection, which is the source of
 * truth. The counter is denormalised, so it can drift if a paste is deleted or
 * an upsert fails after the paste was written — this is how you get it back.
 */
export async function recountAll() {
  const groups = await Paste.aggregate([
    { $match: { fingerprint: { $exists: true } } },
    { $group: { _id: '$fingerprint', count: { $sum: 1 }, lastSeenAt: { $max: '$createdAt' } } },
  ]);

  if (groups.length === 0) return { updated: 0 };

  const result = await Fingerprint.bulkWrite(
    groups.map((g) => ({
      updateOne: {
        filter: { _id: g._id },
        update: { $set: { count: g.count, lastSeenAt: g.lastSeenAt } },
      },
    })),
    { ordered: false }
  );

  logger.info({ groups: groups.length }, 'fingerprint counts rebuilt');
  return { updated: result.modifiedCount };
}
