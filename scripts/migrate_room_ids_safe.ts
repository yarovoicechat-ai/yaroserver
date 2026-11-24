import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { Room } from '../src/models/room.model';
import { getNextRoomId, isValid9DigitRoomId } from '../src/utils/roomIdGenerator';

/**
 * Safe Room ID Migration Script
 * Preserves all historical records, creates backup, maps legacy IDs to new 9-digit Room IDs.
 */
async function runMigration() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/yaro';
  console.log('[Migration] Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('[Migration] Connected successfully.');

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection not established.');
  }

  const timestamp = Date.now();
  const backupCollectionName = `rooms_backup_${timestamp}`;
  console.log(`[Migration] Creating backup collection: ${backupCollectionName}...`);

  const allRooms = await db.collection('rooms').find({}).toArray();
  if (allRooms.length > 0) {
    await db.collection(backupCollectionName).insertMany(allRooms);
    console.log(`[Migration] Backed up ${allRooms.length} room documents to ${backupCollectionName}.`);
  } else {
    console.log('[Migration] No rooms found to backup.');
  }

  // Create mapping collection if not exists
  const mappingCollection = db.collection('room_id_mappings');
  await mappingCollection.createIndex({ oldRoomId: 1 }, { unique: true });
  await mappingCollection.createIndex({ newRoomId: 1 }, { unique: true });

  // Find rooms without 9-digit channelName
  const roomsToMigrate = await Room.find({
    channelName: { $not: /^\d{9}$/ },
  });

  console.log(`[Migration] Found ${roomsToMigrate.length} rooms needing 9-digit Room ID migration.`);

  let migratedCount = 0;
  for (const room of roomsToMigrate) {
    const oldId = room.channelName;
    const newId = await getNextRoomId();

    room.legacyId = oldId;
    room.channelName = newId;
    await room.save();

    await mappingCollection.updateOne(
      { oldRoomId: oldId },
      {
        $set: {
          oldRoomId: oldId,
          newRoomId: newId,
          roomObjectId: room._id,
          migratedAt: new Date(),
        },
      },
      { upsert: true }
    );

    console.log(`[Migration] Room "${room.title}" migrated: ${oldId} -> ${newId}`);
    migratedCount++;
  }

  console.log(`[Migration] Completed successfully. Migrated: ${migratedCount} rooms.`);
  console.log(`[Migration] Backup available in collection: ${backupCollectionName}`);
  await mongoose.disconnect();
  process.exit(0);
}

runMigration().catch((err) => {
  console.error('[Migration] Failed:', err);
  process.exit(1);
});
