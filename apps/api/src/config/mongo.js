import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../lib/logger.js';

mongoose.set('strictQuery', true);

/**
 * Index builds are an explicit migration step (`npm run indexes:sync`), never a
 * side effect of booting. autoIndex on a large collection blocks startup and
 * hides which indexes actually exist in production.
 */
mongoose.set('autoIndex', false);

export async function connectMongo(uri = env.MONGO_URI) {
  mongoose.connection.on('disconnected', () => logger.warn('mongo disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('mongo reconnected'));

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    // Default is 100. Named explicitly because pool saturation is the first
    // thing that breaks under load, and a magic default is hard to defend.
    maxPoolSize: 50,
    minPoolSize: 5,
  });

  logger.info({ db: mongoose.connection.name }, 'mongo connected');
  return mongoose.connection;
}

export async function disconnectMongo() {
  await mongoose.disconnect();
}

/** @returns {Promise<boolean>} */
export async function pingMongo() {
  try {
    if (mongoose.connection.readyState !== 1) return false;
    await mongoose.connection.db.admin().ping();
    return true;
  } catch {
    return false;
  }
}
