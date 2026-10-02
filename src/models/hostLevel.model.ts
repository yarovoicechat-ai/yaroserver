import mongoose, { Schema, model, Document } from "mongoose";

export type HostLevelRewardType = 'frame' | 'entry';

export interface IHostLevelReward {
    type: HostLevelRewardType;
    name: string;
    imageUrl?: string;
    animationUrl?: string;
    durationDays: number; // 0 means permanent
}

export interface IHostLevel extends Document {
    level: number;
    name: string;
    minCalls: number;       // Total calls required to reach this level
    minMinutes: number;     // Total call minutes required
    coinPerMinute: number;  // Commission: coins per minute host earns at this level
    expiresAt?: Date;       // Optional expiration date for temporary levels
    rewards: IHostLevelReward[];
}

const HostLevelRewardSchema = new Schema<IHostLevelReward>({
    type: { type: String, enum: ['frame', 'entry'], required: true },
    name: { type: String, required: true, trim: true },
    imageUrl: { type: String, default: '' },
    animationUrl: { type: String, default: '' },
    durationDays: { type: Number, min: 0, default: 30 },
}, { _id: false });

const HostLevelSchema = new Schema<IHostLevel>(
    {
        level: { type: Number, required: true, unique: true },
        name: { type: String, required: true },
        minCalls: { type: Number, default: 0 },
        minMinutes: { type: Number, default: 0 },
        coinPerMinute: { type: Number, default: 1 },
        expiresAt: { type: Date },
        rewards: { type: [HostLevelRewardSchema], default: [] },
    },
    { timestamps: true }
);

const HostLevel = mongoose.models.HostLevel || model<IHostLevel>("HostLevel", HostLevelSchema);
export default HostLevel;
