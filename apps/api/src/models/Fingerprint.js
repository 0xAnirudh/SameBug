import mongoose from 'mongoose';

/**
 * One document per unique error signature.
 *
 * _id is the hash itself, so recording an occurrence is a single upsert with no
 * secondary lookup and no read-modify-write.
 */
const fingerprintSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    runtime: { type: String, enum: ['node', 'python'], required: true },
    errorType: { type: String, required: true },
    normalizedMessage: { type: String, required: true },
    topFrame: { type: String, default: '' },
    allFramesAreVendor: { type: Boolean, default: false },

    /**
     * Denormalised for the "seen N times" badge, which must not run a count
     * query on every paste view. It is a cache of a fact that lives in the
     * pastes collection, so it can drift — scripts/recountFingerprints.js
     * rebuilds it from the source of truth.
     */
    count: { type: Number, default: 0 },

    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
  },
  { versionKey: false, _id: false }
);

/** "Which errors are most common" and "what's new" — both index-only. */
fingerprintSchema.index({ count: -1 });
fingerprintSchema.index({ lastSeenAt: -1 });

export const Fingerprint =
  mongoose.models.Fingerprint ?? mongoose.model('Fingerprint', fingerprintSchema);
