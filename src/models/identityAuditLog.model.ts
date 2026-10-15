import mongoose, { Schema, Document, Types } from 'mongoose';

export type IdentityAuditAction =
  | 'grant_entitlement'
  | 'revoke_entitlement'
  | 'extend_entitlement'
  | 'create_tier'
  | 'update_tier'
  | 'toggle_tier'
  | 'delete_tier'
  | 'create_effect'
  | 'update_effect'
  | 'upload_asset';

export interface IIdentityAuditLog extends Document {
  action: IdentityAuditAction;
  targetUserId?: number; // permanent numeric user ID
  targetUserObjectId?: Types.ObjectId;
  targetUserName?: string;
  entitlementType?: string;
  details: Record<string, any>;
  performedBy: {
    adminId?: Types.ObjectId;
    adminName: string;
    role: string;
    ip?: string;
  };
  timestamp: Date;
}

const IdentityAuditLogSchema = new Schema<IIdentityAuditLog>(
  {
    action: { type: String, required: true, index: true },
    targetUserId: { type: Number, index: true },
    targetUserObjectId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    targetUserName: { type: String, default: '' },
    entitlementType: { type: String, default: '' },
    details: { type: Schema.Types.Mixed, default: {} },
    performedBy: {
      adminId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      adminName: { type: String, default: 'System' },
      role: { type: String, default: 'admin' },
      ip: { type: String, default: '' },
    },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

IdentityAuditLogSchema.index({ targetUserId: 1, action: 1, timestamp: -1 });

export const IdentityAuditLog = mongoose.model<IIdentityAuditLog>(
  'IdentityAuditLog',
  IdentityAuditLogSchema
);
