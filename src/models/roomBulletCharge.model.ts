import mongoose, { Schema } from 'mongoose';
const schema = new Schema({
  senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  requestId: { type: String, required: true },
  roomId: { type: String, required: true },
  text: { type: String, required: true },
  diamonds: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
}, { timestamps: true });
schema.index({ senderId: 1, requestId: 1 }, { unique: true });
export const RoomBulletCharge = mongoose.model('RoomBulletCharge', schema);
