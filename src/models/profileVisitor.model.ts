import mongoose, { Schema, Document } from "mongoose";

export interface IProfileVisitor extends Document {
  profileUserId: mongoose.Types.ObjectId;
  visitorId: mongoose.Types.ObjectId;
  visitCount: number;
  lastVisitedAt: Date;
  firstVisitedAt: Date;
}

const profileVisitorSchema = new Schema<IProfileVisitor>(
  {
    profileUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    visitorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    visitCount: { type: Number, default: 1, min: 1 },
    lastVisitedAt: { type: Date, default: Date.now, index: true },
    firstVisitedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Compound unique index: each visitor has one record per profile owner
profileVisitorSchema.index({ profileUserId: 1, visitorId: 1 }, { unique: true });
profileVisitorSchema.index({ profileUserId: 1, lastVisitedAt: -1 });

export const ProfileVisitor = mongoose.model<IProfileVisitor>("ProfileVisitor", profileVisitorSchema);
export default ProfileVisitor;
