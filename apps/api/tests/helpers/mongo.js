import './env.js';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

/** @type {MongoMemoryServer | undefined} */
let mongod;

/** Starts an in-process MongoDB. No Docker required, in CI or on a laptop. */
export async function startMemoryMongo() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  return uri;
}

export async function stopMemoryMongo() {
  await mongoose.disconnect();
  await mongod?.stop();
}

/** Wipe between tests so ordering never matters. */
export async function clearCollections() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
