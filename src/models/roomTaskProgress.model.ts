import mongoose, { Schema, Document } from 'mongoose';

export interface IRoomTaskProgress extends Document {
  roomId: string;
  userId: mongoose.Types.ObjectId;
  dateKey: string; // YYYY-MM-DD in IST (UTC+5:30)
  taskId: string;
  category: 'Gifts' | 'Followers' | 'Visitors' | 'Host';
  title: string;
  description: string;
  target: number;
  unit: string;
  progress: number;
  reward: number;
  status: 'in_progress' | 'claimable' | 'claimed';
  claimedAt?: Date;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const RoomTaskProgressSchema = new Schema<IRoomTaskProgress>(
  {
    roomId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    dateKey: { type: String, required: true, index: true },
    taskId: { type: String, required: true },
    category: {
      type: String,
      enum: ['Gifts', 'Followers', 'Visitors', 'Host'],
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    target: { type: Number, required: true },
    unit: { type: String, default: 'count' },
    progress: { type: Number, default: 0 },
    reward: { type: Number, required: true },
    status: {
      type: String,
      enum: ['in_progress', 'claimable', 'claimed'],
      default: 'in_progress',
      index: true,
    },
    claimedAt: { type: Date },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

RoomTaskProgressSchema.index({ roomId: 1, userId: 1, dateKey: 1, taskId: 1 }, { unique: true });
RoomTaskProgressSchema.index({ dateKey: 1, category: 1 });

export const RoomTaskProgress = mongoose.model<IRoomTaskProgress>(
  'RoomTaskProgress',
  RoomTaskProgressSchema
);
