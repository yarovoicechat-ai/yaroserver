import { Schema, model } from "mongoose";

const schema = new Schema(
  {
    host: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, maxlength: 80 },
    category: { type: String, enum: ["Live", "Beauty", "PK"], default: "Live" },
    country: { type: String, default: "India" },
    mode: { type: String, enum: ["single", "multi"], default: "single" },
    maxGuests: { type: Number, default: 1 },
    coverImage: { type: String, default: "" },
    status: { type: String, enum: ["live", "ended"], default: "live" },
    projectId: { type: String, required: true },
    hostUid: { type: Number, required: true },
    heartbeatAt: { type: Date, default: Date.now },
    endedAt: Date,
    endReason: String,
    isPinned: { type: Boolean, default: false },
    totalDiamonds: { type: Number, default: 0 },
    totalLikes: { type: Number, default: 0 },
    viewers: [
      { user: { type: Schema.Types.ObjectId, ref: "User" }, heartbeatAt: Date },
    ],
    guests: [
      {
        user: { type: Schema.Types.ObjectId, ref: "User" },
        agoraUid: Number,
        role: { type: String, default: "guest" },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
    joinRequests: [
      {
        user: { type: Schema.Types.ObjectId, ref: "User" },
        requestedAt: { type: Date, default: Date.now },
      },
    ],
    pk: {
      isActive: { type: Boolean, default: false },
      rivalRoomId: { type: Schema.Types.ObjectId, ref: "LiveBroadcast" },
      rivalHost: { type: Schema.Types.ObjectId, ref: "User" },
      durationSeconds: { type: Number, default: 300 },
      startTime: Date,
      endTime: Date,
      leftScore: { type: Number, default: 0 },
      rightScore: { type: Number, default: 0 },
      leftContributors: [
        {
          user: { type: Schema.Types.ObjectId, ref: "User" },
          amount: Number,
        },
      ],
      rightContributors: [
        {
          user: { type: Schema.Types.ObjectId, ref: "User" },
          amount: Number,
        },
      ],
    },
    topContributors: [
      {
        user: { type: Schema.Types.ObjectId, ref: "User" },
        amount: Number,
      },
    ],
  },
  { timestamps: true }
);
schema.index(
  { host: 1 },
  { unique: true, partialFilterExpression: { status: "live" } }
);
schema.index({ status: 1, heartbeatAt: -1 });
export default model("LiveBroadcast", schema);
