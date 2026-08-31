import mongoose from 'mongoose';

/**
 * An immutable record of one change. Actor and target names are denormalised
 * so the trail still reads correctly after the account or record it refers to
 * has been deleted — which is exactly when the trail matters most.
 */
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: 'System' },
    actorRole: { type: String, default: 'system' },

    // Coarse grouping, so the console can filter the noisy categories out.
    category: {
      type: String,
      enum: ['account', 'attendance', 'schedule', 'security'],
      required: true,
      index: true,
    },
    // Dotted verb, e.g. 'user.update' or 'entry.delete'.
    action: { type: String, required: true },

    targetType: { type: String, enum: ['user', 'entry', 'schedule'], default: 'user' },
    target: { type: mongoose.Schema.Types.ObjectId, default: null },
    targetName: { type: String, default: '' },
    // The role of the account the change landed on, so "changes to admins" is filterable.
    targetRole: { type: String, default: '' },

    // Field-level before/after. Empty for creates and deletes.
    changes: [
      {
        _id: false,
        field: { type: String, required: true },
        from: { type: String, default: null },
        to: { type: String, default: null },
      },
    ],

    // Free-text summary rendered in the console.
    summary: { type: String, default: '' },
    at: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

auditLogSchema.index({ at: -1 });

export default mongoose.model('AuditLog', auditLogSchema);
