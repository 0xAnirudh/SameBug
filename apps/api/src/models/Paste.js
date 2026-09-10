import mongoose from 'mongoose';

export const KINDS = ['code', 'log', 'stacktrace'];
export const VISIBILITIES = ['public', 'unlisted', 'private'];
export const LANGUAGES = ['plaintext', 'javascript', 'typescript', 'python', 'json'];

const frameSchema = new mongoose.Schema(
  {
    file: String,
    line: Number,
    col: Number,
    function: String,
    isApp: Boolean,
  },
  { _id: false }
);

const pasteSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true },
    title: { type: String, maxlength: 120, trim: true },
    content: { type: String, required: true },
    language: { type: String, enum: LANGUAGES, default: 'plaintext' },
    kind: { type: String, enum: KINDS, default: 'code' },

    // Only present when a stack trace parsed successfully. Never written as
    // null — the partial index below keys off the field being absent.
    fingerprint: { type: String },
    parsed: {
      type: new mongoose.Schema(
        {
          runtime: String,
          errorType: String,
          message: String,
          normalizedMessage: String,
          frames: [frameSchema],
          allFramesAreVendor: Boolean,
        },
        { _id: false }
      ),
      default: undefined,
    },

    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    visibility: { type: String, enum: VISIBILITIES, default: 'public' },

    // Flushed from Redis in batches (phase 6), never incremented per request.
    views: { type: Number, default: 0 },

    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/**
 * Every read of a paste goes through this. Unique also makes slug collision
 * handling a caught duplicate-key error rather than a pre-check round trip.
 */
pasteSchema.index({ slug: 1 }, { unique: true });

/**
 * "All occurrences of this error, newest first."
 *
 * Equality before sort: Mongo seeks to the fingerprint prefix, and entries
 * inside that prefix are already stored createdAt-descending, so results come
 * back sorted straight out of the index with no in-memory SORT stage. Reversed,
 * the index could not seek to a fingerprint at all.
 *
 * Partial because most pastes are ordinary code with no fingerprint — indexing
 * them would waste space and cache residency for no query.
 */
pasteSchema.index(
  { fingerprint: 1, createdAt: -1, _id: -1 },
  { partialFilterExpression: { fingerprint: { $exists: true } } }
);

/** Recent public pastes feed. Sort-only, no equality predicate. */
pasteSchema.index({ createdAt: -1 });

/**
 * "My pastes" — same equality-then-sort shape, and the cursor rides the index.
 *
 * _id is in the key for a specific reason. Cursor pagination tie-breaks on _id
 * so two pastes sharing a timestamp cannot be skipped or repeated, which means
 * the sort is { createdAt: -1, _id: -1 }. Without _id in the index Mongo can
 * satisfy only the first sort field and finishes the job with an in-memory SORT
 * stage — measured at 167 keys examined to return 20. With it, the index
 * provides a total order and the sort disappears.
 */
pasteSchema.index({ authorId: 1, createdAt: -1, _id: -1 });

/**
 * Mongo's background sweeper deletes expired pastes. No cron, no job. Note the
 * sweeper runs roughly once a minute, so expiry is eventual, not instant, and
 * documents with expiresAt: null are never touched.
 */
pasteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

pasteSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

// Guarded: the mongoose singleton outlives a module registry reset.
export const Paste = mongoose.models.Paste ?? mongoose.model('Paste', pasteSchema);
