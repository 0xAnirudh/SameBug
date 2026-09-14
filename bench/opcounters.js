/**
 * Mongo operation counters, for the "how much load did we take off the
 * database" half of the benchmark.
 *
 *   node --env-file=.env.bench bench/opcounters.js          # snapshot
 *   node --env-file=.env.bench bench/opcounters.js compare <json>
 */
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../apps/api/src/config/mongo.js';

await connectMongo();
const status = await mongoose.connection.db.admin().serverStatus();
const now = { t: Date.now(), ...status.opcounters };
await disconnectMongo();

if (process.argv[2] === 'compare') {
  const before = JSON.parse(process.argv[3]);
  const seconds = (now.t - before.t) / 1000;
  const rate = (k) => Number(((now[k] - before[k]) / seconds).toFixed(1));
  const total = (k) => now[k] - before[k];

  console.log(
    JSON.stringify({
      seconds: Number(seconds.toFixed(1)),
      queryPerSec: rate('query'),
      updatePerSec: rate('update'),
      insertPerSec: rate('insert'),
      commandPerSec: rate('command'),
      writesPerSec: Number((rate('update') + rate('insert')).toFixed(1)),
      totalQueries: total('query'),
      totalUpdates: total('update'),
    })
  );
} else {
  console.log(JSON.stringify(now));
}
