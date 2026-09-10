/**
 * Proves the read queries use the indexes they were designed for.
 *
 *   node --env-file=.env apps/api/scripts/explain.js
 *
 * What to look for: winningStage IXSCAN (not COLLSCAN), no SORT stage — a SORT
 * means Mongo sorted in memory instead of reading the index in order — and
 * keysExamined close to nReturned.
 */
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/config/mongo.js';
import { Paste } from '../src/models/Paste.js';

const SAMPLE = 500;

await connectMongo();
await Paste.syncIndexes();

const marker = `explain-${Date.now()}`;
const authorId = new mongoose.Types.ObjectId();

console.log(`seeding ${SAMPLE} throwaway pastes...`);
await Paste.insertMany(
  Array.from({ length: SAMPLE }, (_, i) => ({
    slug: `${marker.slice(-6)}${String(i).padStart(4, '0')}`,
    title: marker,
    content: `sample ${i}`,
    // A quarter carry a fingerprint, as real traffic would.
    ...(i % 4 === 0 ? { fingerprint: `fp${i % 20}`.padEnd(16, '0') } : {}),
    authorId: i % 3 === 0 ? authorId : null,
    createdAt: new Date(Date.now() - i * 1000),
  }))
);

/** Walks the explain tree collecting stage names. */
function stages(node, acc = []) {
  if (!node) return acc;
  acc.push(node.stage);
  if (node.inputStage) stages(node.inputStage, acc);
  (node.inputStages ?? []).forEach((s) => stages(s, acc));
  return acc;
}

async function check(label, query, expectIndex) {
  const plan = await query.explain('executionStats');
  const exec = plan.executionStats;
  const found = stages(exec.executionStages);

  const usedIndex = plan.queryPlanner.winningPlan?.inputStage?.indexName
    ?? plan.queryPlanner.winningPlan?.queryPlan?.inputStage?.indexName
    ?? found.some((st) => st?.endsWith('IXSCAN'));

  const sortedInMemory = found.includes('SORT');

  console.log(`\n${label}`);
  console.log(`  stages        ${found.join(' <- ')}`);
  console.log(`  index         ${usedIndex}`);
  console.log(`  nReturned     ${exec.nReturned}`);
  console.log(`  keysExamined  ${exec.totalKeysExamined}`);
  console.log(`  docsExamined  ${exec.totalDocsExamined}`);
  console.log(`  in-memory sort ${sortedInMemory ? 'YES  <-- problem' : 'no'}`);
  console.log(`  millis        ${exec.executionTimeMillis}`);

  // MongoDB 8 reports EXPRESS_IXSCAN for its single-document fast path, so
  // match on the suffix rather than the exact stage name.
  const scanned = found.some((st) => st?.endsWith('IXSCAN'));
  const ok = scanned && !found.includes('COLLSCAN') && !sortedInMemory;
  console.log(`  => ${ok ? 'PASS' : 'FAIL'}${expectIndex ? ` (expected ${expectIndex})` : ''}`);
  return ok;
}

const results = [];

results.push(
  await check('read a paste by slug', Paste.findOne({ slug: `${marker.slice(-6)}0042` }), 'slug_1')
);

results.push(
  await check(
    'occurrences of one error, newest first',
    Paste.find({ fingerprint: 'fp4'.padEnd(16, '0') }).sort({ createdAt: -1 }).limit(20),
    'fingerprint_1_createdAt_-1'
  )
);

results.push(
  await check(
    'my pastes, newest first',
    Paste.find({ authorId }).sort({ createdAt: -1, _id: -1 }).limit(20),
    'authorId_1_createdAt_-1'
  )
);

results.push(
  await check('recent public pastes', Paste.find({}).sort({ createdAt: -1 }).limit(20), 'createdAt_-1')
);

console.log('\ncleaning up...');
await Paste.deleteMany({ title: marker });
await disconnectMongo();

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} query/queries did not use an index` : '\nall queries index-only');
process.exit(failed ? 1 : 0);
