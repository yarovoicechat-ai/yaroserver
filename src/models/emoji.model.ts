import mongoose, { Schema, Document } from 'mongoose';

export interface IEmoji extends Document {
  code: string;
  name: string;
  category: string;
  icon: string;
  pngUrl: string;
  gifUrl: string;
  sortOrder: number;
  isActive: boolean;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const EmojiSchema = new Schema<IEmoji>(
  {
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, default: 'Expressions', trim: true, index: true },
    icon: { type: String, required: true, trim: true },
    pngUrl: { type: String, required: true, trim: true },
    gifUrl: { type: String, required: true, trim: true },
    sortOrder: { type: Number, default: 0, index: true },
    isActive: { type: Boolean, default: true, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const Emoji =
  (mongoose.models.Emoji as mongoose.Model<IEmoji>) ||
  mongoose.model<IEmoji>('Emoji', EmojiSchema);
export default Emoji;

