import mongoose, { Schema } from 'mongoose';
const model = (name: string, schema: Schema): mongoose.Model<Record<string, any>> => mongoose.models[name] || mongoose.model<Record<string, any>>(name, schema);
const targetSchema = new Schema({ hostId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  month: { type: String, required: true }, channels: { type: [String], required: true },
  voice: Number, video: Number, room: Number, roomVolume: Number, revision: { type: Number, default: 0 }, updatedBy: Schema.Types.ObjectId,
}, { timestamps: true });
targetSchema.index({ hostId: 1, month: 1 }, { unique: true });
export const HostTeamTarget = model('HostTeamTarget', targetSchema);
const inviteSchema = new Schema({ inviterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, role: { type: String, required: true },
  state: { type: String, enum: ['pending', 'submitted', 'declined', 'expired'], default: 'pending' },
  requestKey: { type: String, required: true }, expiresAt: { type: Date, required: true },
  applicationId: Schema.Types.ObjectId, requestId: Schema.Types.ObjectId,
}, { timestamps: true });
inviteSchema.index({ inviterId: 1, requestKey: 1 }, { unique: true });
inviteSchema.index({ recipientId: 1, state: 1, createdAt: -1 });
inviteSchema.index({ inviterId: 1, recipientId: 1, role: 1 }, { unique: true, partialFilterExpression: { state: 'pending' } });
export const TeamInvitation = model('TeamInvitation', inviteSchema);

const exportSchema = new Schema({ digest: { type: String, required: true, unique: true }, actorId: { type: Schema.Types.ObjectId, required: true }, actorRole: String, month: String, hostIds: [Schema.Types.ObjectId], csv: String, tsv: String, xlsxBase64: String, expiresAt: { type: Date, required: true } }, { timestamps: true });
exportSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const TeamExport = model('TeamExport', exportSchema);
