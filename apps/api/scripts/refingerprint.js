/**
 * Recomputes every fingerprint and rebuilds the fingerprints collection.
 *
 *   node --env-file-if-exists=.env apps/api/scripts/refingerprint.js [--dry]
 *
 * Any change to the parser, the normalization rules or the hash input changes
 * what a trace fingerprints to, which orphans every group already stored — the
 * counts stay, but new occurrences of the same bug land in a new group and the
 * old one stops growing. This is the repair, and it is the reason the
 * fingerprint module is pure: it can be re-run over history with no I/O
 * assumptions.
 *
 * Safe to run repeatedly. It is idempotent.
 */
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/config/mongo.js';
import { Paste } from '../src/models/Paste.js';
import { Fingerprint } from '../src/models/Fingerprint.js';
import { fingerprint } from '../src/fingerprint/index.js';

const DRY = process.argv.includes('--dry');
const BATCH = 500;

await connectMongo();

const total = await Paste.countDocuments();
console.log(`${DRY ? '[dry run] ' : ''}re-fingerprinting ${total} paste(s)\n`);

let scanned = 0;
let changed = 0;
let gained = 0; // did not parse before, does now
let lost = 0; // parsed before, does not now

/** hash -> { count, firstSeenAt, lastSeenAt, parsed } */
const groups = new Map();
let writes = [];

const cursor = Paste.find({}, 'slug content kind fingerprint createdAt').cursor();

for await (const paste of cursor) {
  scanned++;

  const parsed = fingerprint(paste.content);
  const before = paste.fingerprint ?? null;
  const after = parsed?.fingerprint ?? null;

  if (before !== after) {
    changed++;
    if (!before && after) gained++;
    if (before && !after) lost++;
  }

  if (parsed) {
    const group = groups.get(after) ?? {
      parsed,
      count: 0,
      firstSeenAt: paste.createdAt,
      lastSeenAt: paste.createdAt,
    };
    group.count += 1;
    if (paste.createdAt < group.firstSeenAt) group.firstSeenAt = paste.createdAt;
    if (paste.createdAt > group.lastSeenAt) group.lastSeenAt = paste.createdAt;
    groups.set(after, group);
  }

  if (!DRY && before !== after) {
    writes.push({
      updateOne: {
        filter: { _id: paste._id },
        update: parsed
          ? {
              $set: {
                kind: 'stacktrace',
                fingerprint: parsed.fingerprint,
                parsed: {
                  runtime: parsed.runtime,
                  errorType: parsed.errorType,
                  message: parsed.message,
                  normalizedMessage: parsed.normalizedMessage,
                  frames: parsed.frames,
                  allFramesAreVendor: parsed.allFramesAreVendor,
                },
              },
            }
          : // Unset rather than null: the partial index keys off the field
            // not existing, and a null would put the document back in it.
            { $unset: { fingerprint: '', parsed: '' } },
      },
    });
  }

  if (writes.length >= BATCH) {
    await Paste.bulkWrite(writes, { ordered: false });
    writes = [];
  }

  if (scanned % 1000 === 0) process.stdout.write(`\r  scanned ${scanned}/${total}`);
}

if (writes.length) await Paste.bulkWrite(writes, { ordered: false });

if (!DRY) {
  // Rebuilt from the pastes collection, which is the source of truth, rather
  // than patched in place — a stale group with no occurrences left should go.
  await Fingerprint.deleteMany({});
  if (groups.size) {
    await Fingerprint.insertMany(
      [...groups].map(([hash, g]) => ({
        _id: hash,
        runtime: g.parsed.runtime,
        errorType: g.parsed.errorType,
        normalizedMessage: g.parsed.normalizedMessage,
        topFrame: g.parsed.topFrame,
        allFramesAreVendor: g.parsed.allFramesAreVendor,
        count: g.count,
        firstSeenAt: g.firstSeenAt,
        lastSeenAt: g.lastSeenAt,
      })),
      { ordered: false }
    );
  }
}

console.log(`\r  scanned ${scanned}/${total}        \n`);
console.log(`  fingerprints changed  ${changed}`);
console.log(`    now parse (new)     ${gained}`);
console.log(`    no longer parse     ${lost}`);
console.log(`  groups after rebuild  ${groups.size}`);
if (DRY) console.log('\n  dry run — nothing written');

await disconnectMongo();
await mongoose.connection.close();
