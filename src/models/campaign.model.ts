import mongoose, { Schema, Document } from 'mongoose';

export type CampaignChannel = 'PUSH_FCM' | 'IN_APP' | 'SYSTEM_BROADCAST';
export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';

export interface ICampaign extends Document {
    title: string;
    message: string;
    channel: CampaignChannel;
    targeting: {
        country: string[];
        gender: string;
        minLevel: number;
        vipOnly: boolean;
        roleSegment: string;
        activityStatus: string;
    };
    schedule: {
        type: 'IMMEDIATE' | 'SCHEDULED';
        scheduledAt?: Date;
    };
    status: CampaignStatus;
    metrics: {
        sent: number;
        delivered: number;
        failed: number;
        opened: number;
        clicked: number;
    };
    createdBy?: mongoose.Types.ObjectId;
    startedAt?: Date;
    completedAt?: Date;
    failureReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

const CampaignSchema = new Schema<ICampaign>({
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    channel: {
        type: String,
        enum: ['PUSH_FCM', 'IN_APP', 'SYSTEM_BROADCAST'],
        default: 'PUSH_FCM'
    },
    targeting: {
        country: [{ type: String, default: 'ALL' }],
        gender: { type: String, default: 'ALL' },
        minLevel: { type: Number, default: 1 },
        vipOnly: { type: Boolean, default: false },
        roleSegment: { type: String, default: 'ALL' },
        activityStatus: { type: String, default: 'ALL' }
    },
    schedule: {
        type: { type: String, enum: ['IMMEDIATE', 'SCHEDULED'], default: 'IMMEDIATE' },
        scheduledAt: { type: Date }
    },
    status: {
        type: String,
        enum: ['DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED'],
        default: 'DRAFT',
        index: true
    },
    metrics: {
        sent: { type: Number, default: 0 },
        delivered: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        opened: { type: Number, default: 0 },
        clicked: { type: Number, default: 0 }
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    startedAt: { type: Date },
    completedAt: { type: Date },
    failureReason: { type: String }
}, { timestamps: true });

CampaignSchema.index({ status: 1, 'schedule.scheduledAt': 1 });
CampaignSchema.index({ createdAt: -1 });

export const Campaign = mongoose.model<ICampaign>('Campaign', CampaignSchema);
