import mongoose, { Schema, Document } from 'mongoose';

export interface IRoom extends Document {
    title: string;
    channelName: string;
    ownerId: mongoose.Types.ObjectId;
    isLocked: boolean;
    category: string;
    tags: string[];
    members: mongoose.Types.ObjectId[];
    coverImage?: string;
    about?: string;
    seatCount?: number;
    mode?: string;
    pinHash?: string;
    isActive: boolean;
    isPinned?: boolean;
    pinnedOrder?: number;
    pinnedAt?: Date;
    themeId?: string;
    themeAsset?: any;
    seatSkinId?: string;
    seatSkinAsset?: any;
    showSeatCharm?: boolean;
    isBanned?: boolean;
    bannedAt?: Date;
    bannedBy?: string;
    bannedByRole?: string;
    bannedBySpecialId?: string;
    banReason?: string;
    unbannedAt?: Date;
    unbannedBy?: string;
    createdAt: Date;
    updatedAt: Date;
}

const RoomSchema = new Schema<IRoom>({
    title: { type: String, required: true },
    channelName: { type: String, required: true, unique: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isLocked: { type: Boolean, default: false },
    category: { type: String, default: 'General' },
    tags: [{ type: String }],
    members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    coverImage: { type: String, default: '' },
    about: { type: String, default: '' },
    seatCount: { type: Number, default: 8 },
    mode: { type: String, default: 'Public' },
    pinHash: { type: String, select: false },
    isActive: { type: Boolean, default: true },
    isPinned: { type: Boolean, default: false },
    pinnedOrder: { type: Number, default: 0 },
    pinnedAt: { type: Date },
    themeId: { type: String, default: null },
    themeAsset: { type: Schema.Types.Mixed, default: null },
    seatSkinId: { type: String, default: null },
    seatSkinAsset: { type: Schema.Types.Mixed, default: null },
    showSeatCharm: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },
    bannedAt: { type: Date },
    bannedBy: { type: String, default: null },
    bannedByRole: { type: String, default: null },
    bannedBySpecialId: { type: String, default: null },
    banReason: { type: String, default: null },
    unbannedAt: { type: Date },
    unbannedBy: { type: String, default: null },
}, { timestamps: true });

RoomSchema.index({ ownerId: 1 });
RoomSchema.index({ category: 1, isActive: 1 });
RoomSchema.index({ isPinned: 1, pinnedOrder: 1 });
RoomSchema.index({ isBanned: 1 });

export const Room = mongoose.model<IRoom>('Room', RoomSchema);
