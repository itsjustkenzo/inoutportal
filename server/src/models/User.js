import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * The one place the password rule lives. The schema and every controller that
 * checks a password read it from here, so the API and the forms cannot drift
 * apart and start disagreeing about what is acceptable.
 */
export const MIN_PASSWORD_LENGTH = 6;

export const PASSWORD_RULE = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Login identifier. Email is kept for contact/display only.
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [32, 'Username must be at most 32 characters'],
      // Runs after the lowercase setter, so only lower-case forms need matching.
      match: [/^[a-z0-9._-]+$/, 'Username may only contain letters, numbers, dots, dashes and underscores'],
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email address'],
    },
    password: {
      type: String,
      required: true,
      minlength: [MIN_PASSWORD_LENGTH, PASSWORD_RULE],
      select: false,
    },
    /*
     * `audit` is read-only oversight: not a moderator, not an administrator.
     * `manager` (Server Manager) outranks admin: it is the only role that may
     * create privileged accounts or rewrite attendance records.
     */
    role: { type: String, enum: ['employee', 'admin', 'audit', 'manager'], default: 'employee' },
    department: { type: String, trim: true, default: 'General' },
    // Geographic region, distinct from the org-chart `department`.
    region: { type: String, trim: true, maxlength: 60, default: 'Global' },
    // Look-and-feel that follows the account across devices.
    prefs: {
      // Audit accounts have no theme picker, so their accent is fixed at green.
      accent: {
        type: String,
        trim: true,
        maxlength: 20,
        default: function () {
          return this.role === 'audit' ? 'green' : 'white';
        },
      },
      dim: { type: Number, min: 0, max: 100, default: 45 },
    },
    // Denormalised current state so the board can be rendered in one query.
    status: { type: String, enum: ['in', 'out'], default: 'out' },
    lastSeenAt: { type: Date, default: null },
    statusNote: { type: String, trim: true, maxlength: 200, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

export default mongoose.model('User', userSchema);
