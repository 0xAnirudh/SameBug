import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true },

    /**
     * Bumping this invalidates every outstanding refresh token for the user in
     * a single write. It is the answer to "JWTs can't be revoked" — refresh
     * tokens carry the version they were minted at and are rejected when it
     * no longer matches.
     */
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Strip the hash at the serialisation boundary rather than in every route, so
// a new endpoint cannot forget to do it.
userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

/**
 * Guarded because mongoose.model() throws OverwriteModelError if the same name
 * is registered twice. The mongoose singleton outlives a module registry reset
 * — which happens when a test runner reuses a worker process, and under any
 * hot reload — so re-evaluating this file must not re-register.
 */
export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
