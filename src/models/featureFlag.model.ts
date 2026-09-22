import mongoose, { Schema, Document } from 'mongoose';

export interface IFeatureFlag extends Document {
    key: string;
    name: string;
    title?: string;
    description: string;
    isEnabled: boolean;
    platform: 'ALL' | 'ANDROID' | 'IOS' | 'WEB';
    country: string[];
    language: string[];
    userSegment: 'ALL' | 'NEW_USERS' | 'VIP_ONLY' | 'HOSTS_ONLY' | 'HIGH_VALUE';
    vipSegment?: string;
    rolloutPercentage: number;
    startDate?: Date;
    endDate?: Date;
    isKillSwitchActive: boolean;
    killSwitchReason?: string;
    allowedRoles?: string[];
    updatedBy?: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const FeatureFlagSchema = new Schema<IFeatureFlag>({
    key: { type: String, required: true, unique: true, index: true, trim: true },
    name: { type: String, required: true, trim: true },
    title: { type: String },
    description: { type: String, default: '' },
    isEnabled: { type: Boolean, default: true, index: true },
    platform: { 
        type: String, 
        enum: ['ALL', 'ANDROID', 'IOS', 'WEB'], 
        default: 'ALL',
        index: true 
    },
    country: [{ type: String, default: '*' }],
    language: [{ type: String, default: '*' }],
    userSegment: { 
        type: String, 
        enum: ['ALL', 'NEW_USERS', 'VIP_ONLY', 'HOSTS_ONLY', 'HIGH_VALUE'], 
        default: 'ALL' 
    },
    vipSegment: { type: String },
    rolloutPercentage: { type: Number, default: 100, min: 0, max: 100 },
    startDate: { type: Date },
    endDate: { type: Date },
    isKillSwitchActive: { type: Boolean, default: false, index: true },
    killSwitchReason: { type: String, default: '' },
    allowedRoles: [{ type: String }],
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Pre-save to keep name & title synchronized
FeatureFlagSchema.pre('save', function (next) {
    if (!this.title && this.name) {
        this.title = this.name;
    } else if (!this.name && this.title) {
        this.name = this.title;
    }
    next();
});

export const FeatureFlag = mongoose.model<IFeatureFlag>('FeatureFlag', FeatureFlagSchema);
