import mongoose from 'mongoose';

/**
 * One punch cycle. `out` stays null while the user is currently IN,
 * which makes "who is in right now" a simple `{ out: null }` query.
 */
const entrySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    in: { type: Date, required: true, default: Date.now },
    out: { type: Date, default: null },
    note: { type: String, trim: true, maxlength: 200, default: '' },
    minutes: { type: Number, default: null },
  },
  { timestamps: true }
);

entrySchema.index({ user: 1, in: -1 });

entrySchema.pre('save', function computeMinutes(next) {
  this.minutes = this.out ? Math.round((this.out - this.in) / 60000) : null;
  next();
});

export default mongoose.model('Entry', entrySchema);
