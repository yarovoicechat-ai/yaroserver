export interface RoomOpenEvent { roomId: string; membershipId: string; isOwner: boolean; wasOnline: boolean }
export const claimRoomOpenEvent = async (redis: { set?: (...args: any[]) => Promise<any> }, event: RoomOpenEvent): Promise<string | null> => {
  if (!event.isOwner || event.wasOnline) return null;
  const eventId = `room-open:${event.roomId}:${Date.now()}`;
  try {
    if (typeof redis?.set === 'function') {
      const claimed = await redis.set(`room_open_notification:${event.roomId}`, '1', 'EX', 1800, 'NX');
      return claimed === 'OK' ? eventId : null;
    }
  } catch (_) {}
  return eventId;
};
