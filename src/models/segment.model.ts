import mongoose, { Schema, Document } from 'mongoose';

export interface ISegmentRules {
    country?: string[];
    gender?: string;
    minLevel?: number;
    vipOnly?: boolean;
    roleSegment?: string;
    activeWithinDays?: number;
    inactiveForDays?: number;
    minCoinsRecharged?: number;
}

export interface ISegment extends Document {
    name: string;
    description: string;
    rules: ISegmentRules;
    cachedCount: number;
    lastCalculatedAt?: Date;
    createdBy?: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const SegmentSchema = new Schema<ISegment>({
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    rules: {
        country: [{ type: String, default: 'ALL' }],
        gender: { type: String, default: 'ALL' },
        minLevel: { type: Number, default: 1 },
        vipOnly: { type: Boolean, default: false },
        roleSegment: { type: String, default: 'ALL' },
        activeWithinDays: { type: Number },
        inactiveForDays: { type: Number },
        minCoinsRecharged: { type: Number }
    },
    cachedCount: { type: Number, default: 0 },
    lastCalculatedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

SegmentSchema.index({ createdAt: -1 });

export const Segment = mongoose.model<ISegment>('Segment', SegmentSchema);
