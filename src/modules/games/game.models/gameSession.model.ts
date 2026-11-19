import mongoose, { Schema, Document, Types } from 'mongoose';

export type SessionStatus = 'CREATING' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'EXPIRED' | 'TERMINATED';
export type RoundState = 'BETTING' | 'SPINNING' | 'SETTLING' | 'WAITING';

export interface IGamePlayer {
  userId: Types.ObjectId;
  userName?: string;
  avatar?: string;
  socketId?: string;
  joinedAt: Date;
  status: 'ACTIVE' | 'MINIMIZED' | 'DISCONNECTED' | 'LEFT';
  totalBetInSession: number;
  totalWonInSession: number;
}

export interface IGameSessionDocument extends Document {
  sessionId: string;
  gameId: string;
  roomId: string;
  hostUserId: Types.ObjectId;
  status: SessionStatus;
  roundNumber: number;
  roundState: RoundState;
  roundEndsAt?: Date;
  players: IGamePlayer[];
  currentRoundBets: {
    userId: Types.ObjectId;
    betTarget: string;
    amount: number;
    placedAt: Date;
  }[];
  lastResult?: {
    winningTarget: string;
    multiplier: number;
    totalBets: number;
    totalPayout: number;
    settledAt: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

const GamePlayerSchema = new Schema<IGamePlayer>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, default: 'Player' },
    avatar: { type: String, default: '' },
    socketId: { type: String, default: '' },
    joinedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['ACTIVE', 'MINIMIZED', 'DISCONNECTED', 'LEFT'],
      default: 'ACTIVE',
    },
    totalBetInSession: { type: Number, default: 0 },
    totalWonInSession: { type: Number, default: 0 },
  },
  { _id: false }
);

const GameSessionSchema = new Schema<IGameSessionDocument>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    gameId: { type: String, required: true, index: true },
    roomId: { type: String, required: true, index: true },
    hostUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['CREATING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'EXPIRED', 'TERMINATED'],
      default: 'ACTIVE',
      index: true,
    },
    roundNumber: { type: Number, default: 1 },
    roundState: {
      type: String,
      enum: ['BETTING', 'SPINNING', 'SETTLING', 'WAITING'],
      default: 'BETTING',
    },
    roundEndsAt: { type: Date },
    players: { type: [GamePlayerSchema], default: [] },
    currentRoundBets: [
      {
        userId: { type: Schema.Types.ObjectId, ref: 'User' },
        betTarget: { type: String },
        amount: { type: Number },
        placedAt: { type: Date, default: Date.now },
      },
    ],
    lastResult: {
      winningTarget: { type: String },
      multiplier: { type: Number },
      totalBets: { type: Number },
      totalPayout: { type: Number },
      settledAt: { type: Date },
    },
  },
  { timestamps: true }
);

GameSessionSchema.index({ roomId: 1, status: 1 });
GameSessionSchema.index({ gameId: 1, status: 1 });

export const GameSession = mongoose.model<IGameSessionDocument>('GameSession', GameSessionSchema);
