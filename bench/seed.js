/**
 * Seeds a realistic dataset for the load test and writes the slug list k6 uses.
 *
 *   node --env-file=.env.bench bench/seed.js [count]
 *
 * Benchmarking an empty database proves nothing — everything fits in RAM and
 * Mongo looks infinitely fast. The point of this script is a working set large
 * enough that index choice and caching actually matter.
 */
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { customAlphabet } from 'nanoid';

import { connectMongo, disconnectMongo } from '../apps/api/src/config/mongo.js';
import { Paste } from '../apps/api/src/models/Paste.js';
import { Fingerprint } from '../apps/api/src/models/Fingerprint.js';
import { fingerprint } from '../apps/api/src/fingerprint/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRACES = join(HERE, '../apps/api/tests/fixtures/traces');

const COUNT = Number(process.argv[2] ?? 8000);
const BATCH = 500;

const nanoid = customAlphabet(
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-',
  10
);

const LANGUAGES = ['plaintext', 'javascript', 'typescript', 'python', 'json'];

const realTraces = readdirSync(TRACES)
  .filter((f) => f.endsWith('.txt'))
  .map((f) => readFileSync(join(TRACES, f), 'utf8'));

/** Deterministic PRNG so two seeded datasets are byte-identical. */
function makeRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
const rand = makeRandom(20260915);

const pick = (list) => list[Math.floor(rand() * list.length)];

/**
 * Real pastes are mostly small with a long tail of large ones. A uniform size
 * would understate how much the content field costs to move around.
 */
function bodySize() {
  const r = rand();
  if (r < 0.7) return 200 + Math.floor(rand() * 1800); // 0.2–2 KB
  if (r < 0.95) return 2000 + Math.floor(rand() * 18000); // 2–20 KB
  return 20000 + Math.floor(rand() * 80000); // 20–100 KB
}

function codeBody(size) {
  const line = 'const value = compute(input, options); // padding for realistic size\n';
  return line.repeat(Math.ceil(size / line.length)).slice(0, size);
}

function logBody(size) {
  const out = [];
  let length = 0;
  while (length < size) {
    const line = `2026-09-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}T10:${String(
      Math.floor(rand() * 60)
    ).padStart(2, '0')}:00Z INFO request completed in ${Math.floor(rand() * 900)}ms\n`;
    out.push(line);
    length += line.length;
  }
  return out.join('').slice(0, size);
}

/**
 * Stack traces are mutated copies of the real fixtures — different paths and
 * line numbers, same underlying bug — so the fingerprint groups behave the way
 * production ones would rather than every trace being unique.
 */
function traceBody() {
  const base = pick(realTraces);
  const host = pick(['/srv/app', '/home/ani/project', '/opt/service', '/var/www/api']);
  return base
    .replace(/\/srv\/app/g, host)
    .replace(/:(\d+):(\d+)/g, () => `:${1 + Math.floor(rand() * 900)}:${1 + Math.floor(rand() * 60)}`)
    .replace(/line \d+/g, () => `line ${1 + Math.floor(rand() * 900)}`);
}

await connectMongo();
await Promise.all([Paste.syncIndexes(), Fingerprint.syncIndexes()]);

console.log(`clearing and seeding ${COUNT} pastes...`);
await Paste.deleteMany({});
await Fingerprint.deleteMany({});

const slugs = [];
const fingerprintCounts = new Map();
const now = Date.now();
const startedAt = Date.now();

for (let offset = 0; offset < COUNT; offset += BATCH) {
  const docs = [];

  for (let i = offset; i < Math.min(offset + BATCH, COUNT); i++) {
    const slug = nanoid();
    slugs.push(slug);

    const roll = rand();
    // 25% traces, 15% logs, 60% ordinary code — roughly what a paste site sees.
    const kind = roll < 0.25 ? 'stacktrace' : roll < 0.4 ? 'log' : 'code';
    const size = bodySize();

    const content =
      kind === 'stacktrace' ? traceBody() : kind === 'log' ? logBody(size) : codeBody(size);

    const doc = {
      slug,
      title: `seed paste ${i}`,
      content,
      language: kind === 'stacktrace' ? 'plaintext' : pick(LANGUAGES),
      kind,
      visibility: 'public',
      authorId: null,
      views: Math.floor(rand() * 500),
      // Spread over 90 days so the createdAt index has a real range to walk.
      createdAt: new Date(now - Math.floor(rand() * 90 * 86400000)),
      expiresAt: null,
    };

    if (kind === 'stacktrace') {
      const parsed = fingerprint(content);
      if (parsed) {
        doc.fingerprint = parsed.fingerprint;
        doc.parsed = {
          runtime: parsed.runtime,
          errorType: parsed.errorType,
          message: parsed.message,
          normalizedMessage: parsed.normalizedMessage,
          frames: parsed.frames,
          allFramesAreVendor: parsed.allFramesAreVendor,
        };

        const existing = fingerprintCounts.get(parsed.fingerprint) ?? {
          parsed,
          count: 0,
          firstSeenAt: doc.createdAt,
          lastSeenAt: doc.createdAt,
        };
        existing.count += 1;
        if (doc.createdAt < existing.firstSeenAt) existing.firstSeenAt = doc.createdAt;
        if (doc.createdAt > existing.lastSeenAt) existing.lastSeenAt = doc.createdAt;
        fingerprintCounts.set(parsed.fingerprint, existing);
      }
    }

    docs.push(doc);
  }

  await Paste.insertMany(docs, { ordered: false });
  process.stdout.write(`\r  ${Math.min(offset + BATCH, COUNT)}/${COUNT}`);
}

await Fingerprint.insertMany(
  [...fingerprintCounts].map(([hash, v]) => ({
    _id: hash,
    runtime: v.parsed.runtime,
    errorType: v.parsed.errorType,
    normalizedMessage: v.parsed.normalizedMessage,
    topFrame: v.parsed.topFrame,
    allFramesAreVendor: v.parsed.allFramesAreVendor,
    count: v.count,
    firstSeenAt: v.firstSeenAt,
    lastSeenAt: v.lastSeenAt,
  })),
  { ordered: false }
);

writeFileSync(join(HERE, 'slugs.json'), JSON.stringify(slugs));

const stats = await mongoose.connection.db.command({ collStats: 'pastes' });
console.log(`\n\nseeded in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
console.log(`  pastes        ${await Paste.countDocuments()}`);
console.log(`  fingerprints  ${fingerprintCounts.size}`);
console.log(`  data size     ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
console.log(`  index size    ${(stats.totalIndexSize / 1024 / 1024).toFixed(1)} MB`);
console.log(`  avg doc       ${(stats.avgObjSize / 1024).toFixed(1)} KB`);
console.log(`  slugs written to bench/slugs.json`);

await disconnectMongo();
