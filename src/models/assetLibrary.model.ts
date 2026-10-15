import mongoose, { Schema, Document } from 'mongoose';

export type AssetCategory =
  | 'avatar_frame'
  | 'entry_animation'
  | 'badge'
  | 'chat_bubble'
  | 'room_theme'
  | 'name_particle'
  | 'sound';

export type AssetFileType = 'svga' | 'lottie' | 'gif' | 'webp' | 'png' | 'mp4' | 'audio';

export interface IAssetLibraryItem extends Document {
  name: string;
  slug: string;
  category: AssetCategory;
  fileUrl: string;
  thumbnailUrl: string;
  fileType: AssetFileType;
  fileSize: number; // in bytes
  dimensions: {
    width: number;
    height: number;
  };
  durationMs: number;
  isLooping: boolean;
  transparentBg: boolean;
  compatiblePlatforms: string[]; // ['android', 'ios', 'web']
  version: number;
  status: 'active' | 'inactive' | 'archived';
  tags: string[];
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const AssetLibraryItemSchema = new Schema<IAssetLibraryItem>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    category: {
      type: String,
      enum: ['avatar_frame', 'entry_animation', 'badge', 'chat_bubble', 'room_theme', 'name_particle', 'sound'],
      required: true,
      index: true,
    },
    fileUrl: { type: String, required: true },
    thumbnailUrl: { type: String, default: '' },
    fileType: {
      type: String,
      enum: ['svga', 'lottie', 'gif', 'webp', 'png', 'mp4', 'audio'],
      required: true,
      index: true,
    },
    fileSize: { type: Number, default: 0 },
    dimensions: {
      width: { type: Number, default: 0 },
      height: { type: Number, default: 0 },
    },
    durationMs: { type: Number, default: 0 },
    isLooping: { type: Boolean, default: true },
    transparentBg: { type: Boolean, default: true },
    compatiblePlatforms: { type: [String], default: ['android', 'ios', 'web'] },
    version: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
      index: true,
    },
    tags: { type: [String], default: [] },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const AssetLibraryItem = mongoose.model<IAssetLibraryItem>(
  'AssetLibraryItem',
  AssetLibraryItemSchema
);
