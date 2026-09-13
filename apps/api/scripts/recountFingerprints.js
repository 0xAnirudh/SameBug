/**
 * Rebuilds every fingerprint count from the pastes collection.
 *
 *   node --env-file=.env apps/api/scripts/recountFingerprints.js
 *
 * The count is denormalised so the "seen N times" badge does not run an
 * aggregation on every view. That means it can drift — a deleted paste, or an
 * upsert that failed after its paste was written. This is the repair.
 */
import { connectMongo, disconnectMongo } from '../src/config/mongo.js';
import { recountAll } from '../src/services/fingerprintService.js';

await connectMongo();
const { updated } = await recountAll();
console.log(`rebuilt counts for ${updated} fingerprint(s)`);
await disconnectMongo();
