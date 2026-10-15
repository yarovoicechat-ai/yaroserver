import mongoose, { Schema, Document } from 'mongoose';
import { IBeansPlan } from '../interfaces/beansPlan.interface';

export interface IBeansPlanDocument extends IBeansPlan, Document {}

const BeansPlanSchema = new Schema<IBeansPlanDocument>(
  {
    name: { type: String, required: true, trim: true },
    beans: { type: Number, required: true, min: 1 },
    diamonds: { type: Number, required: true, min: 1 },
    bonusDiamonds: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    badge: { type: String, default: '' },
    type: {
      type: String,
      enum: ['exchange', 'purchase', 'agency'],
      default: 'exchange',
    },
    description: { type: String, default: '' },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0, index: true },
  },
  { timestamps: true }
);

export const BeansPlan = mongoose.model<IBeansPlanDocument>('BeansPlan', BeansPlanSchema);
