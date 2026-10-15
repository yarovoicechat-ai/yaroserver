import mongoose, { Document, Schema } from "mongoose";

interface ITempHost extends Document {
  hostId: number;
  userId: number;
  query?: string;
  isVerified: boolean;
  audioURL?: string;
  hostTypes?: string[];
  createdAt: Date;
}

const TempHostSchema = new Schema<ITempHost>(
  {
    hostId: { type: Number, required: true },
    userId: { type: Number, required: true, unique: true },
    query: { type: String, default: "" },
    isVerified: { type: Boolean, default: false },
    audioURL: { type: String },
    hostTypes: { type: [String], default: ['voice'] },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const TempHostModel = mongoose.model<ITempHost>("TempHost", TempHostSchema);

export default TempHostModel;
