import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IGift extends Document {
    name: string;
    icon: string; // URL of the gift icon
    animationUrl?: string;
    mediaType?: 'image' | 'gif' | 'webp' | 'svg' | 'svga';
    cost: number; // Cost in coins
    category?: string;
    isActive: boolean;
    price?: number;
    slug?: string;
    image?: string;
    animation?: string;
    categoryId?: any;
    rarity?: string;
    sortOrder?: number;
    isNewItem?: boolean;
    isHot?: boolean;
    isVip?: boolean;
    isVipOnly?: boolean;
    isLimited?: boolean;
    comboEnabled?: boolean;
    animationType?: string;
    duration?: number;
    sound?: string;
    entryEffect?: string;
    metadata?: any;
    startsAt?: Date | null;
    endsAt?: Date | null;
}

const giftSchema = new Schema<IGift>(
    {
        name: { type: String, required: true },
        icon: { type: String, required: true },
        animationUrl: { type: String, default: '' },
        mediaType: {
            type: String,
            enum: ['image', 'gif', 'webp', 'svg', 'svga'],
            default: 'image',
        },
        cost: { type: Number, required: true },
        category: { type: String, default: 'Standard' },
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true, strict: false }
);

export const Gift: Model<IGift> =
    (mongoose.models.Gift as Model<IGift>) || mongoose.model<IGift>('Gift', giftSchema);
