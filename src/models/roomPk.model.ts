import mongoose, { Schema } from 'mongoose';

const RoomPKSchema = new Schema({
  roomIds: { type: [String], required: true },
  rooms: { type: [Schema.Types.Mixed], required: true },
  // The partial multikey unique index reserves BOTH rooms atomically.
  busyRoomIds: { type: [String], required: true },
  isOpen: { type: Boolean, default: true },
  status: { type: String, enum: ['invited', 'active', 'finished', 'declined', 'cancelled', 'expired'], default: 'invited' },
  invitedBy: { type: String, required: true },
  inviteExpiresAt: { type: Date, required: true },
  startedAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  durationSeconds: { type: Number, default: 300, enum: [300] },
  scores: { type: [Number], default: [0, 0] },
  winnerRoomId: { type: String, default: null },
  loserRoomId: { type: String, default: null },
  draw: { type: Boolean, default: false },
  finishedAt: { type: Date, default: null },
}, { timestamps: true, autoIndex: true });

RoomPKSchema.index({ busyRoomIds: 1 }, { unique: true, partialFilterExpression: { isOpen: true } });
RoomPKSchema.index({ roomIds: 1, createdAt: -1 });
RoomPKSchema.index({ isOpen: 1, status: 1, endsAt: 1, inviteExpiresAt: 1 });

export const RoomPK = mongoose.models.RoomPK || mongoose.model('RoomPK', RoomPKSchema);
