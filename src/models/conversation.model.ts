import mongoose, { Document, Schema, Model } from "mongoose";

// Conversation interface
export interface IConversation extends Document {
  participants: mongoose.Types.ObjectId[];
  lastMessage?: mongoose.Types.ObjectId;
  isArchived?: boolean;
  clearedFor?: mongoose.Types.ObjectId[];
  clearedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Schema
const conversationSchema = new Schema<IConversation>(
  {
    participants: [
      { type: Schema.Types.ObjectId, ref: "User", required: true },
    ],
    lastMessage: { type: Schema.Types.ObjectId, ref: "Message" },
    isArchived: { type: Boolean, default: false, index: true },
    clearedFor: [{ type: Schema.Types.ObjectId, ref: "User" }],
    clearedAt: { type: Date },
  },
  { timestamps: true }
);

// Indexes for performance
conversationSchema.index({ participants: 1 }); // Find conversations by user
conversationSchema.index({ updatedAt: -1 }); // Sort by recent activity
conversationSchema.index({ isArchived: 1 });
conversationSchema.index({ clearedFor: 1 });

// Model
const Conversation: Model<IConversation> = mongoose.model<IConversation>(
  "Conversation",
  conversationSchema
);

export default Conversation;
