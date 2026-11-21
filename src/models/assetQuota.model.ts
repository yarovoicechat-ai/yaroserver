import mongoose, { Schema, Document } from 'mongoose';

export interface IAssetDurationPackage {
  days: number; // e.g. 7, 15, 30, 0 (permanent)
  allocatedQuantity: number;
  remainingQuantity: number;
}

export interface IAssetQuota extends Document {
  operatorId: mongoose.Types.ObjectId;
  operatorName: string;
  assetId?: mongoose.Types.ObjectId;
  uniqueId?: string;
  assetName: string;
  assetCategory: string; // 'Frames' | 'Entry Effect' | 'Badge' | 'Tag' | 'Chat Bubble' | etc.
  imageUrl?: string;
  animationUrl?: string;
  packages: IAssetDurationPackage[];
  allocatedBy: mongoose.Types.ObjectId;
  allocatedByRole: string; // 'owner'
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AssetDurationPackageSchema = new Schema(
  {
    days: { type: Number, required: true },
    allocatedQuantity: { type: Number, required: true, default: 0 },
    remainingQuantity: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const AssetQuotaSchema = new Schema<IAssetQuota>(
  {
    operatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    operatorName: { type: String, default: '' },
    assetId: { type: Schema.Types.ObjectId, ref: 'StoreItem' },
    uniqueId: { type: String, default: '', index: true },
    assetName: { type: String, required: true, index: true },
    assetCategory: { type: String, required: true, index: true },
    imageUrl: { type: String, default: '' },
    animationUrl: { type: String, default: '' },
    packages: { type: [AssetDurationPackageSchema], default: [] },
    allocatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    allocatedByRole: { type: String, default: 'owner' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

AssetQuotaSchema.index({ operatorId: 1, assetName: 1 });

export const AssetQuota = mongoose.model<IAssetQuota>('AssetQuota', AssetQuotaSchema);
