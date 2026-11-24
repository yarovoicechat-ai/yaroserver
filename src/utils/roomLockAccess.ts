import { createHash } from 'crypto';
import { isRoomOwner } from './roomVoiceAuthorization';

export const roomPinGrantKey = (room: any, userId: string) => {
  const id = typeof room === 'object' && room !== null
    ? String(room._id || room.channelName || room.roomId || room.id || '')
    : String(room || '');
  return `room_pin_grant:${id}:${userId}`;
};

export const roomPinVersion = (room: any) => createHash('sha256').update(String(room?.pinHash || '')).digest('hex');

export const canEnterLockedRoom = (room: any, user: any, grant: string | null = null, isGlobalManager = false) => {
  if (!room?.isLocked || !room?.pinHash) return true;
  const ownerIds = [
    (room.ownerId as any)?._id,
    (room.ownerId as any)?.id,
    (room.ownerId as any)?.userId,
    room.ownerId,
  ].filter(Boolean).map(String);

  const userIds = [
    user?.id,
    user?._id,
    user?.userId,
  ].filter(Boolean).map(String);

  const isOwnerMatch = ownerIds.some(oid => userIds.includes(oid)) ||
    isRoomOwner({
      userId: String(user?.id || user?._id || ''),
      numericUserId: String(user?.userId || ''),
      roomOwnerId: ownerIds[0] || '',
      roomChannelName: room.channelName,
      requestedRoomId: room.channelName || room.roomId,
    });

  if (isGlobalManager || isOwnerMatch) return true;
  return Boolean(grant && grant === roomPinVersion(room));
};

