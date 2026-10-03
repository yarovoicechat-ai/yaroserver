import mongoose, { Schema, Document } from 'mongoose';

export interface ISystemConfig extends Document {
  key: string;
  isFamilyEnabled: boolean;
  isCpEnabled: boolean;
  storeCategories: string[];
  maintenanceMode: boolean;
  metadata?: Record<string, any>;
  updatedAt: Date;
  createdAt: Date;
}

const SystemConfigSchema = new Schema<ISystemConfig>(
  {
    key: { type: String, required: true, unique: true, default: 'global_config' },
    isFamilyEnabled: { type: Boolean, default: true },
    isCpEnabled: { type: Boolean, default: true },
    storeCategories: {
      type: [String],
      default: [
        'Unique ID',
        'Frames',
        'Chat Bubble',
        'Theme',
        'Tassel',
        'Entry',
        'Mic Wave',
        'Profile Card',
        'Room Card',
        'Profile Entry',
        'VIP',
        'King of Kings',
      ],
    },
    maintenanceMode: { type: Boolean, default: false },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const SystemConfig =
  (mongoose.models.SystemConfig as mongoose.Model<ISystemConfig>) ||
  mongoose.model<ISystemConfig>('SystemConfig', SystemConfigSchema);

export default SystemConfig;
