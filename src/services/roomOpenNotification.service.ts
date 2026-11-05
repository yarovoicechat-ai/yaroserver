import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { User } from '../models/user.model';
import { createNotification } from '../controllers/notificationController';
import { sendPushNotification } from '../utils/pushNotification';

export const notifyRoomFollowers = async (room: { ownerId: unknown; channelName: string; title: string; openEventId?: string }) => {
  let owner: any = null;
  const rawOwnerId = room.ownerId;
  if (Types.ObjectId.isValid(String(rawOwnerId))) {
    owner = await User.findById(rawOwnerId).select('_id name blockedUsers followers').lean();
  }
  if (!owner && rawOwnerId) {
    owner = await User.findOne({
      $or: [
        { userId: Number(rawOwnerId) || -1 },
        { meethiId: String(rawOwnerId) },
        { _id: Types.ObjectId.isValid(String(rawOwnerId)) ? rawOwnerId : null },
      ],
    }).select('_id name blockedUsers followers').lean();
  }
  if (!owner) return;

  const ownerDbId = owner._id;
  const title = (owner.name || 'Someone you follow') + ' opened a room';
  const body = room.title ? `Join room: ${room.title}` : 'Join their voice room party!';
  const notificationId = room.openEventId || `room-open:${room.channelName}:${randomUUID()}`;
  const data = {
    notificationId,
    eventId: notificationId,
    type: 'room_open',
    action: 'open_room',
    roomId: String(room.channelName),
    ownerId: String(ownerDbId),
  };

  const followerFilter: any = {
    $or: [
      { following: ownerDbId },
      { _id: { $in: owner.followers || [] } },
    ],
    _id: { $ne: ownerDbId, $nin: owner.blockedUsers || [] },
    blockedUsers: { $ne: ownerDbId },
    isDeleted: { $ne: true },
    isBlocked: { $ne: true },
  };

  const cursor = User.find(followerFilter).select('_id fcmToken').lean().cursor();
  let tokens: string[] = [];

  let io: any = null;
  let getUserRoom: any = null;
  try {
    const socketModule = require('../sockets');
    io = socketModule.getIO?.();
    getUserRoom = socketModule.getUserRoom;
  } catch (_) {}

  for await (const follower of cursor) {
    await createNotification(String(follower._id), title, body, 'event', data).catch(() => {});
    if (io && getUserRoom) {
      io.to(getUserRoom(String(follower._id))).emit('room:opened_by_following', {
        title,
        body,
        ...data,
      });
    }
    if (follower.fcmToken) tokens.push(follower.fcmToken);
    if (tokens.length >= 500) {
      await sendPushNotification(tokens, { title, body, data }).catch(() => {});
      tokens = [];
    }
  }
  if (tokens.length) await sendPushNotification(tokens, { title, body, data }).catch(() => {});
};
