import { User } from '../models/user.model';
import { createNotification } from '../controllers/notificationController';
import { sendPushNotification } from '../utils/pushNotification';

export const notifyRoomFollowers = async (room: { ownerId: unknown; channelName: string; title: string }) => {
  const owner = await User.findById(room.ownerId).select('name blockedUsers').lean();
  if (!owner) return;
  const title = (owner.name || 'Someone you follow') + ' opened a room';
  const body = room.title || 'Join their voice room';
  const data = { type: 'room_open', action: 'open_room', roomId: String(room.channelName), ownerId: String(room.ownerId) };
  const cursor = User.find({ following: room.ownerId,
    _id: { $ne: room.ownerId, $nin: owner.blockedUsers || [] },
    blockedUsers: { $ne: room.ownerId }, isDeleted: { $ne: true }, isBlocked: { $ne: true },
  }).select('_id fcmToken').lean().cursor();
  let tokens: string[] = [];
  for await (const follower of cursor) {
    await createNotification(String(follower._id), title, body, 'event', data);
    if (follower.fcmToken) tokens.push(follower.fcmToken);
    if (tokens.length >= 500) {
      await sendPushNotification(tokens, { title, body, data });
      tokens = [];
    }
  }
  if (tokens.length) await sendPushNotification(tokens, { title, body, data });
};
