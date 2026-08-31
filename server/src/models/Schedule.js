import mongoose from 'mongoose';

/**
 * A moderator's recurring weekly shift.
 *
 * Times are minutes from midnight (0–1439) in the organisation's base zone
 * rather than "HHMM" strings: duration and overlap are arithmetic, and the
 * timeline view positions bars straight from the number. `end <= start` means
 * the shift runs past midnight.
 */
const scheduleSchema = new mongoose.Schema(
  {
    // One schedule per moderator, replaced when reassigned.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    start: { type: Number, required: true, min: 0, max: 1439 },
    end: { type: Number, required: true, min: 0, max: 1439 },
    // 0 = Sunday … 6 = Saturday, matching Date#getDay.
    days: {
      type: [Number],
      required: true,
      validate: {
        validator: (d) => d.length > 0 && d.every((n) => Number.isInteger(n) && n >= 0 && n <= 6),
        message: 'days must contain between one and seven values from 0 to 6',
      },
    },
  },
  { timestamps: true }
);

export default mongoose.model('Schedule', scheduleSchema);
