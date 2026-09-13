/**
 * Explicit index migration. autoIndex is off in the app, so this is the only
 * thing that creates indexes — run it as a deploy step.
 *
 *   node --env-file=.env apps/api/scripts/syncIndexes.js
 */
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/config/mongo.js';
import { User } from '../src/models/User.js';
import { Paste } from '../src/models/Paste.js';
import { Fingerprint } from '../src/models/Fingerprint.js';

const models = [User, Paste, Fingerprint];

await connectMongo();

for (const model of models) {
  const dropped = await model.syncIndexes();
  const current = await model.collection.indexes();
  console.log(`${model.modelName}: ${current.length} indexes` + (dropped.length ? ` (dropped ${dropped.join(', ')})` : ''));
  for (const ix of current) console.log(`  ${ix.name}  ${JSON.stringify(ix.key)}`);
}

await disconnectMongo();
await mongoose.connection.close();
