import { Room } from '../models/room.model';

export const STARTING_ROOM_ID = 100000000; // 9 digits series start

/**
 * Generate next sequential 9-digit Room ID starting from 100000000.
 */
export const getNextRoomId = async (): Promise<string> => {
  try {
    // Find highest 9-digit numeric channelName
    const lastRoom = await Room.findOne({
      channelName: { $regex: '^\\d{9}$' }
    })
      .sort({ channelName: -1 })
      .select('channelName')
      .lean();

    if (!lastRoom || !lastRoom.channelName) {
      return String(STARTING_ROOM_ID);
    }

    const lastNum = parseInt(lastRoom.channelName, 10);
    if (isNaN(lastNum) || lastNum < STARTING_ROOM_ID) {
      return String(STARTING_ROOM_ID);
    }

    return String(lastNum + 1);
  } catch (error) {
    console.error('[roomIdGenerator] Error calculating next room ID:', error);
    return String(STARTING_ROOM_ID);
  }
};
