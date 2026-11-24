import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { Room } from '../src/models/room.model';

/**
 * Safe Room ID Rollback Script
 * Reverts channelName to legacyId from room documents.
 */
async function runRollback() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/yaro';
  console.log('[Rollback] Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('[Rollback] Connected successfully.');

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection not established.');
  }

  // Find rooms that have a legacyId
  const roomsToRollback = await Room.find({
    legacyId: { $ne: null, $exists: true },
  });

  console.log(`[Rollback] Found ${roomsToRollback.length} rooms with legacyId.`);

  let rollbackCount = 0;
  for (const room of roomsToRollback) {
    if (room.legacyId) {
      const currentId = room.channelName;
      room.channelName = room.legacyId;
      room.legacyId = undefined;
      await room.save();
      console.log(`[Rollback] Reverted room "${room.title}": ${currentId} -> ${room.channelName}`);
      rollbackCount++;
    }
  }

  console.log(`[Rollback] Completed successfully. Reverted: ${rollbackCount} rooms.`);
  await mongoose.disconnect();
  process.exit(0);
}

runRollback().catch((err) => {
  console.error('[Rollback] Failed:', err);
  process.exit(1);
});
