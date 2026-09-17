import mongoose, { Schema, model, Document } from "mongoose";

export interface ILevel extends Document {
    level: number;
    name: string;
    minCalls: number;       // Total calls required to reach this level
    minMinutes: number;     // Total call minutes required
    coinPerMinute: number;  // Commission: coins per minute host earns at this level
    image?: string;
    text?: string;
}

const LevelSchema = new Schema<ILevel>(
    {
        level: { type: Number, required: true, unique: true },
        name: { type: String, default: "" },
        text: { type: String },
        minCalls: { type: Number, default: 0 },
        minMinutes: { type: Number, default: 0 },
        coinPerMinute: { type: Number, default: 1 },
        image: { type: String },
    },
    { timestamps: true }
);

const Level = mongoose.models.Level || model<ILevel>("Level", LevelSchema);
export default Level;
