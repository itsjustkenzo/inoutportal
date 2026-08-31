import mongoose from 'mongoose';

/**
 * An admin's note against one moderator on one day.
 *
 * The day is a plain "YYYY-MM-DD" string rather than a Date. A remark belongs
 * to the day whoever wrote it was looking at, so it is a label, not an instant —
 * storing a Date would drag timezone conversion into it and could shift the note
 * onto the day either side when read from a different region.
 */
const remarkSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'],
    },
    text: { type: String, trim: true, maxlength: 500, default: '' },
    // Who last wrote it, kept by name too so the note survives their account.
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    authorName: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

// One note per person per day; writing again replaces it.
remarkSchema.index({ user: 1, date: 1 }, { unique: true });

export default mongoose.model('Remark', remarkSchema);
