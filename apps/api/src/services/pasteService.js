import { customAlphabet } from 'nanoid';
import { Paste } from '../models/Paste.js';
import { AppError } from '../lib/AppError.js';
import { env } from '../config/env.js';
import { detectLanguage, detectKind } from '../lib/detect.js';
import * as cache from './cacheService.js';

/**
 * URL-safe, no lookalike-hostile characters removed — 64 symbols over 10 slots
 * is ~60 bits. At a million pastes the collision chance is under one in a
 * million, and the unique index catches the rest.
 */
const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-', 10);

const EXPIRY_PRESETS = {
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  never: null,
};

export function expiryToDate(preset) {
  const ms = EXPIRY_PRESETS[preset ?? 'never'];
  return ms === null || ms === undefined ? null : new Date(Date.now() + ms);
}

export async function createPaste({ content, title, language, visibility, expiry, authorId }) {
  // Byte length, not string length — a 1MB cap must mean bytes on the wire.
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > env.MAX_PASTE_BYTES) {
    throw AppError.payloadTooLarge(
      `That paste is ${Math.round(bytes / 1024)}KB; the limit is ${Math.round(env.MAX_PASTE_BYTES / 1024)}KB`
    );
  }

  const doc = {
    title,
    content,
    language: language ?? detectLanguage(content),
    kind: detectKind(content), // phase 5 upgrades this to 'stacktrace' when it parses
    visibility: visibility ?? 'public',
    authorId: authorId ?? null,
    expiresAt: expiryToDate(expiry),
  };

  // One retry is enough: a second collision on 60 bits of entropy is not a
  // thing that happens, and an unbounded retry loop hides a real problem.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await Paste.create({ ...doc, slug: nanoid() });
    } catch (err) {
      if (err.code === 11000 && attempt === 0) continue;
      throw err;
    }
  }
}

/**
 * @returns {Promise<{ paste: import('mongoose').Document, cacheStatus: string }>}
 */
export async function getPasteBySlug(slug, viewer) {
  const key = cache.pasteKey(slug);

  const { value, status } = await cache.safely(() => cache.get(key), {
    value: null,
    status: cache.CACHE_MISS,
  });

  let paste = value;
  if (!paste) {
    paste = await Paste.findOne({ slug });
    if (paste) await cache.safely(() => cache.set(key, paste), undefined);
  }

  if (!paste) throw AppError.notFound('That paste does not exist, or it expired');

  assertCanRead(paste, viewer);
  return { paste, cacheStatus: status };
}

/**
 * A private paste is 404 rather than 403 for anyone who is not its owner.
 * 403 would confirm the slug exists, which is exactly what we are hiding.
 */
function assertCanRead(paste, viewer) {
  if (paste.visibility !== 'private') return;
  if (viewer && paste.authorId && String(paste.authorId) === String(viewer.id)) return;
  throw AppError.notFound('That paste does not exist, or it expired');
}

export async function deletePaste(slug, viewer) {
  const paste = await Paste.findOne({ slug });
  if (!paste) throw AppError.notFound('That paste does not exist, or it expired');

  // Anonymous pastes have no owner, so nobody can delete them. The UI says so
  // at creation time rather than letting someone find out later.
  if (!paste.authorId) {
    throw AppError.forbidden('Anonymous pastes cannot be deleted — they expire instead');
  }
  if (String(paste.authorId) !== String(viewer.id)) {
    throw AppError.forbidden('That paste belongs to someone else');
  }

  await paste.deleteOne();
  await cache.safely(() => cache.del(cache.pasteKey(slug)), undefined);
}

/**
 * Cursor pagination, not skip. skip(N) makes Mongo walk and discard N index
 * entries, so page 500 costs 500 times page 1. A cursor is a seek.
 */
export function encodeCursor(paste) {
  return Buffer.from(`${paste.createdAt.toISOString()}|${paste._id}`).toString('base64url');
}

function decodeCursor(cursor) {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()) || !id) throw new Error('bad cursor');
    return { date, id };
  } catch {
    throw AppError.badRequest('That page cursor is not valid');
  }
}

export async function listPastesByAuthor(authorId, { cursor, limit = 20 } = {}) {
  const capped = Math.min(Math.max(limit, 1), 50);

  const filter = { authorId };
  if (cursor) {
    const { date, id } = decodeCursor(cursor);
    // Tie-break on _id so pastes sharing a timestamp cannot be skipped or repeated.
    filter.$or = [{ createdAt: { $lt: date } }, { createdAt: date, _id: { $lt: id } }];
  }

  // Fetch one extra to know whether another page exists without a count query.
  const rows = await Paste.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(capped + 1)
    .select('-content');

  const hasMore = rows.length > capped;
  const items = hasMore ? rows.slice(0, capped) : rows;

  return {
    items,
    nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null,
  };
}
