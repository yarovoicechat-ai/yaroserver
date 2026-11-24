import { Room } from '../models/room.model';
import { Counter } from '../models/counter.model';

export const STARTING_ROOM_ID = 100000000; // Exactly 9 digits
export const MAX_ROOM_ID = 999999999;
export const COUNTER_MODEL_NAME = 'room_id_sequence';

/**
 * Validates whether a room ID is a valid 9-digit format.
 */
export const isValid9DigitRoomId = (roomId: string): boolean => {
  return /^\d{9}$/.test(String(roomId || '').trim());
};

/**
 * Check if a Room ID is available for creation.
 */
export const isRoomIdAvailable = async (roomId: string): Promise<{ available: boolean; reason?: string }> => {
  const cleanId = String(roomId || '').trim();
  if (!isValid9DigitRoomId(cleanId)) {
    return { available: false, reason: 'Room ID must contain exactly 9 digits.' };
  }

  const existing = await Room.findOne({
    $or: [
      { channelName: cleanId },
      { legacyId: cleanId },
    ],
  }).select('_id channelName').lean();

  if (existing) {
    return { available: false, reason: `Room ID ${cleanId} is already in use.` };
  }

  return { available: true };
};

/**
 * Generate next sequential 9-digit Room ID atomically starting from 100000000.
 * Concurrency-safe: uses atomic MongoDB Counter increment and skips existing/custom IDs.
 */
export const getNextRoomId = async (): Promise<string> => {
  let attempts = 0;
  const maxAttempts = 500;

  while (attempts < maxAttempts) {
    attempts++;

    // Atomic increment of room sequence counter
    const counter = await Counter.findOneAndUpdate(
      { modelName: COUNTER_MODEL_NAME },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    let candidateSeq = counter.seq;

    // If counter is uninitialized or below STARTING_ROOM_ID, jump to STARTING_ROOM_ID
    if (!candidateSeq || candidateSeq < STARTING_ROOM_ID) {
      await Counter.updateOne(
        { modelName: COUNTER_MODEL_NAME },
        { $set: { seq: STARTING_ROOM_ID } }
      );
      candidateSeq = STARTING_ROOM_ID;
    }

    if (candidateSeq > MAX_ROOM_ID) {
      throw new Error('[roomIdGenerator] 9-digit Room ID series exhausted.');
    }

    const candidateId = String(candidateSeq);

    // Ensure candidate is not already occupied by a custom room or legacy room
    const existing = await Room.findOne({
      $or: [
        { channelName: candidateId },
        { legacyId: candidateId },
      ],
    }).select('_id').lean();

    if (!existing) {
      return candidateId;
    }
  }

  throw new Error('[roomIdGenerator] Failed to allocate unique 9-digit Room ID after max attempts.');
};
