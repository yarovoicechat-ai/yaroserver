import { Schema, model } from "mongoose";

const schema = new Schema(
  {
    host: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, maxlength: 80 },
    category: { type: String, enum: ["Live", "Beauty", "PK"], default: "Live" },
    coverImage: { type: String, default: "" },
    status: { type: String, enum: ["live", "ended"], default: "live" },
    projectId: { type: String, required: true },
    hostUid: { type: Number, required: true },
    heartbeatAt: { type: Date, default: Date.now },
    endedAt: Date,
    endReason: String,
    isPinned: { type: Boolean, default: false },
    viewers: [
      { user: { type: Schema.Types.ObjectId, ref: "User" }, heartbeatAt: Date },
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
