import { createHash } from 'crypto';
import { isRoomOwner } from './roomVoiceAuthorization';
export const roomPinGrantKey = (room: any, userId: string) => `room_pin_grant:${String(room._id || room.channelName)}:${userId}`;
export const roomPinVersion = (room: any) => createHash('sha256').update(String(room.pinHash || '')).digest('hex');
export const canEnterLockedRoom = (room: any, user: any, grant: string | null = null, isGlobalManager = false) => {
  if (!room?.isLocked) return true;
  if (isGlobalManager || isRoomOwner({ userId: String(user?.id || user?._id || ''), numericUserId: String(user?.userId || ''), roomOwnerId: String(room.ownerId || ''), roomChannelName: room.channelName, requestedRoomId: room.channelName })) return true;
  return Boolean(room.pinHash && grant && grant === roomPinVersion(room));
};
