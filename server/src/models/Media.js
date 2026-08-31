import mongoose from 'mongoose';

/**
 * A user's avatar or wallpaper, held as binary.
 *
 * Kept out of the User document on purpose: a wallpaper runs to several MB, and
 * every `User.find()` would otherwise drag that payload along. One row per
 * user+kind, replaced on upload.
 */
const mediaSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['avatar', 'wallpaper'], required: true },
    data: { type: Buffer, required: true },
    contentType: { type: String, required: true },
  },
  { timestamps: true }
);

mediaSchema.index({ user: 1, kind: 1 }, { unique: true });

export default mongoose.model('Media', mediaSchema);
