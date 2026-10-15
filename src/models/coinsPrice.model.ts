import mongoose, { Schema } from 'mongoose';
import { IPricePlan } from '../interfaces/coinsPrice.interface';

const pricePlanSchema = new Schema<IPricePlan>(
  {
    title: { type: String, default: "" },
    description: { type: String, required: true },
    actualPrice: { type: Number, required: true },
    discountedPrice: { type: Number, default: 0 },
    coins: { type: Number, required: true },
    diamonds: { type: Number, default: 0 },
    bonusCoins: { type: Number, default: 0 },
    badge: { type: String, default: "" },
    productId: { type: String, default: "" },
    type: {
      type: String,
      enum: ["offline", "online", "google_play", "special"],
      default: "online",
      required: true,
    },
    icon: { type: String, default: "" },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0, index: true },
    currency: { type: String, default: "INR" },
  },
  { timestamps: true }
);

export const PricePlan = mongoose.model<IPricePlan>(
  "PricePlan",
  pricePlanSchema
);

