import mongoose, { Schema, Document } from 'mongoose';

export interface ICallQuality extends Document {
    callId: mongoose.Types.ObjectId;
    channelName: string;
    userId: mongoose.Types.ObjectId;
    role: 'caller' | 'host';
    bitrate?: number;
    packetLossRate?: number;
    jitter?: number;
    rtt?: number;
    qualityScore?: number;
    audioQuality?: 'EXCELLENT' | 'GOOD' | 'POOR' | 'CRITICAL';
    networkState?: 'ONLINE' | 'DEGRADED' | 'DISCONNECTED';
    disconnectReason?: string;
    recordedAt: Date;
}

const CallQualitySchema = new Schema<ICallQuality>({
    callId: { type: Schema.Types.ObjectId, ref: 'CoinsTransaction', required: true, index: true },
    channelName: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['caller', 'host'], required: true },
    bitrate: { type: Number },
    packetLossRate: { type: Number },
    jitter: { type: Number },
    rtt: { type: Number },
    qualityScore: { type: Number },
    audioQuality: { 
        type: String, 
        enum: ['EXCELLENT', 'GOOD', 'POOR', 'CRITICAL'],
        default: 'GOOD'
    },
    networkState: {
        type: String,
        enum: ['ONLINE', 'DEGRADED', 'DISCONNECTED'],
        default: 'ONLINE'
    },
    disconnectReason: { type: String },
    recordedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: { createdAt: true, updatedAt: false } });

CallQualitySchema.index({ callId: 1, recordedAt: -1 });

export const CallQuality = mongoose.model<ICallQuality>('CallQuality', CallQualitySchema);
