import mongoose, { Schema, Document } from 'mongoose';

export interface IRoomContribution extends Document {
  roomId: string;
  userId: mongoose.Types.ObjectId;
  dateKey: string; // YYYY-MM-DD in IST
  weekKey: string; // YYYY-MM-DD_YYYY-MM-DD in IST (Mon-Sun)
  monthKey: string; // YYYY-MM in IST
  diamonds: number;
  createdAt: Date;
  updatedAt: Date;
}

const RoomContributionSchema = new Schema<IRoomContribution>(
  {
    roomId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    dateKey: { type: String, required: true, index: true },
    weekKey: { type: String, required: true, index: true },
    monthKey: { type: String, required: true, index: true },
    diamonds: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// Unique compound index per room, user, and date
RoomContributionSchema.index({ roomId: 1, dateKey: 1, userId: 1 }, { unique: true });
RoomContributionSchema.index({ roomId: 1, dateKey: 1, diamonds: -1 });
RoomContributionSchema.index({ roomId: 1, weekKey: 1, diamonds: -1 });
RoomContributionSchema.index({ roomId: 1, monthKey: 1, diamonds: -1 });
RoomContributionSchema.index({ userId: 1, dateKey: 1 });

export const RoomContribution =
  (mongoose.models.RoomContribution as mongoose.Model<IRoomContribution>) ||
  mongoose.model<IRoomContribution>('RoomContribution', RoomContributionSchema);
