import mongoose, { Document, Schema } from 'mongoose';

export interface IRoomWatchQueueItem {
  videoId: string;
  videoTitle: string;
  videoThumbnail: string;
  channelTitle: string;
  duration?: string;
  durationSeconds?: number;
  addedBy: string;
  addedByName?: string;
  addedAt: Date;
}

export interface IRoomWatchSession extends Document {
  roomId: string;
  videoId: string;
  videoTitle: string;
  videoThumbnail: string;
  channelTitle: string;
  duration: string;
  durationSeconds: number;
  status: 'idle' | 'playing' | 'paused' | 'ended';
  currentTime: number;
  playbackRate: number;
  lastUpdatedAt: Date;
  updatedBy: string;
  hostUserId: string;
  queue: IRoomWatchQueueItem[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RoomWatchQueueItemSchema = new Schema<IRoomWatchQueueItem>(
  {
    videoId: { type: String, required: true },
    videoTitle: { type: String, required: true },
    videoThumbnail: { type: String, default: '' },
    channelTitle: { type: String, default: '' },
    duration: { type: String, default: '00:00' },
    durationSeconds: { type: Number, default: 0 },
    addedBy: { type: String, required: true },
    addedByName: { type: String, default: 'Member' },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const RoomWatchSessionSchema = new Schema<IRoomWatchSession>(
  {
    roomId: { type: String, required: true, index: true },
    videoId: { type: String, default: '' },
    videoTitle: { type: String, default: '' },
    videoThumbnail: { type: String, default: '' },
    channelTitle: { type: String, default: '' },
    duration: { type: String, default: '00:00' },
    durationSeconds: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['idle', 'playing', 'paused', 'ended'],
      default: 'idle',
    },
    currentTime: { type: Number, default: 0 },
    playbackRate: { type: Number, default: 1 },
    lastUpdatedAt: { type: Date, default: Date.now },
    updatedBy: { type: String, default: '' },
    hostUserId: { type: String, default: '' },
    queue: [RoomWatchQueueItemSchema],
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

RoomWatchSessionSchema.index({ roomId: 1, isActive: 1 });
RoomWatchSessionSchema.index({ updatedAt: -1 });

export const RoomWatchSession = mongoose.model<IRoomWatchSession>(
  'RoomWatchSession',
  RoomWatchSessionSchema
);
