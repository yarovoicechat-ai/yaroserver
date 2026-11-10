import mongoose, { Schema } from 'mongoose';

const media = new Schema({
  id: String,
  name: { type: String, required: true, maxlength: 100 },
  imageUrl: { type: String, required: true },
  animationUrl: { type: String, required: true },
  isActive: { type: Boolean, default: true },
}, { _id: false });

const schema = new Schema({
  level: { type: Number, required: true, unique: true, min: 1, max: 5 },
  frame: { type: media, required: true },
  entry: { type: media, required: true },
}, { timestamps: true });

export const VipAssets = mongoose.models.VipAssets || mongoose.model('VipAssets', schema);
