import mongoose, { Document, Schema, Model } from "mongoose";

// Message interface
export interface IMessage extends Document {
  conversationId: mongoose.Types.ObjectId;
  sender: mongoose.Types.ObjectId;
  receiver: mongoose.Types.ObjectId;
  content: string;
  type: "text" | "image" | "video" | "audio" | "file";
  status: "sent" | "delivered" | "seen";
  createdAt: Date;
  updatedAt: Date;
  requestId?: string;
  diamondsCharged?: number;
}

// Schema
const messageSchema = new Schema<IMessage>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    content: { type: String, required: true },
    requestId: { type: String },
    diamondsCharged: { type: Number, default: 0, min: 0 },
    type: {
      type: String,
      enum: ["text", "image", "video", "audio", "file"],
      default: "text",
    },
    status: {
      type: String,
      enum: ["sent", "delivered", "seen"],
      default: "sent",
    },
  },
  { timestamps: true }
);

// Indexes for performance
messageSchema.index({ conversationId: 1, createdAt: 1 }); // Fetch messages in order
messageSchema.index({ sender: 1, receiver: 1 }); // Find conversations between users
messageSchema.index({ receiver: 1, status: 1 }); // Find unseen messages
messageSchema.index({ sender: 1, requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: 'string' } } });

// Model
const Message: Model<IMessage> = mongoose.model<IMessage>(
  "Message",
  messageSchema
);

export default Message;
