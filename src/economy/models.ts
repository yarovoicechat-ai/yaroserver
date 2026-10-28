import mongoose, { Schema } from 'mongoose';
const model = (name: string, schema: Schema): mongoose.Model<Record<string, any>> => (mongoose.models[name] as mongoose.Model<Record<string, any>>) || mongoose.model<Record<string, any>>(name, schema);
const whole = { type: Number, required: true, validate: Number.isSafeInteger };
export const EconomyVersion = model('EconomyVersion', new Schema({
  version: { type: String, required: true, unique: true },
  effectiveAt: { type: Date, required: true }, rules: { type: Schema.Types.Mixed, required: true },
  digest: { type: String, required: true }, createdBy: { type: Schema.Types.ObjectId, required: true },
  reason: { type: String, required: true },
}, { timestamps: true }));
export const EconomyRollout = model('EconomyRollout', new Schema({
  key: { type: String, unique: true, default: 'economy' }, enabled: { type: Boolean, default: false },
  version: String, revision: { type: Number, default: 0 }, changedBy: Schema.Types.ObjectId,
  reason: String, releaseDecision: String,
}, { timestamps: true }));
export const EconomyAccount = model('EconomyAccount', new Schema({
  key: { type: String, unique: true, required: true }, asset: { type: String, enum: ['BEAN'], required: true },
  balance: { ...whole, default: 0 },
}, { timestamps: true }));
const journalSchema = new Schema({
  key: { type: String, unique: true, required: true }, fingerprint: { type: String, required: true },
  kind: { type: String, required: true }, version: { type: String, required: true },
  actor: { type: String, required: true }, postings: { type: [Schema.Types.Mixed], required: true },
  metadata: { type: Schema.Types.Mixed, required: true }, result: Schema.Types.Mixed,
  reversedBy: String,
}, { timestamps: { createdAt: true, updatedAt: false } });
journalSchema.index({ version: 1, kind: 1, createdAt: 1 });
export const EconomyJournal = model('EconomyJournal', journalSchema);
const monthSchema = new Schema({
  key: { type: String, required: true, unique: true }, hostId: { type: String, required: true },
  month: { type: String, required: true }, version: { type: String, required: true },
  giftUnits: { ...whole, default: 0 }, reserveBeans: { ...whole, default: 0 },
  settled: { type: Boolean, default: false },
}, { timestamps: true });
export const EconomyHostMonth = model('EconomyHostMonth', monthSchema);
const evidenceSchema = new Schema({
  hostId: { type: String, required: true }, minute: { ...whole }, version: { type: String, required: true },
  roomId: { type: String, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
evidenceSchema.index({ hostId: 1, minute: 1 }, { unique: true });
export const EconomyHostingMinute = model('EconomyHostingMinute', evidenceSchema);
export const EconomyValidation = model('EconomyValidation', new Schema({
  reportId: { type: String, unique: true, required: true }, digest: { type: String, required: true },
  version: { type: String, required: true }, kind: { type: String, required: true },
  report: { type: Schema.Types.Mixed, required: true }, createdBy: Schema.Types.ObjectId,
}, { timestamps: true }));
