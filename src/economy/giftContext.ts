import { Types } from 'mongoose';
import { Room } from '../models/room.model';
import LiveBroadcast from '../models/liveBroadcast.model';

/** Returns the voice PK channel when the validated gift belongs to a voice room. */
export async function validateGiftRoomContext(roomId: string, sender: any, receivers: any[]): Promise<string | null> {
  const room = await Room.findOne({ $or: [{ channelName: String(roomId) },
    ...(Types.ObjectId.isValid(String(roomId)) ? [{ _id: roomId }] : [])] }).lean();
  if (room) {
    if (room.isBanned) throw new Error('Room is unavailable');
    const { getVoiceRoomState } = await import('../sockets/voiceRoomSocket');
    const channel = String(room.channelName || roomId);
    const state = await getVoiceRoomState(channel);
    const present = Object.keys(state.onlineUsers || {});
    const senderKeys = [sender._id, sender.userId, sender.id].filter(Boolean).map(String);
    const isSenderPresent = senderKeys.some(id => present.includes(id)) ||
      state.seats.some(seat => senderKeys.includes(String(seat.user?.userId || '')) || senderKeys.includes(String((seat.user as any)?.id || '')) || senderKeys.includes(String((seat.user as any)?._id || ''))) ||
      senderKeys.includes(String(room.ownerId));
    if (!isSenderPresent && present.length > 0) throw new Error('Sender is not present in this room');
    for (const rec of receivers) {
      const recKeys = [rec._id, rec.userId, rec.id].filter(Boolean).map(String);
      const isRecSeatedOrHost = state.seats.some(seat => {
        const user = seat.user;
        if (!user) return false;
        return [user.userId, (user as any).id, (user as any)._id].filter(Boolean).map(String).some(id => recKeys.includes(id));
      }) || recKeys.includes(String(room.ownerId)) || recKeys.includes(String(state.hostUser?.userId || (state.hostUser as any)?._id || ''));
      if (!isRecSeatedOrHost) throw new Error('Recipient is not seated in this room');
    }
    return channel;
  }

  if (!Types.ObjectId.isValid(String(roomId))) throw new Error('Room is unavailable');
  const lease = new Date(Date.now() - 90000);
  const live = await LiveBroadcast.findOne({ _id: roomId, status: 'live', heartbeatAt: { $gt: lease } }).lean();
  if (!live) throw new Error('Room is unavailable');
  const senderId = String(sender._id || sender.id);
  const hostId = String(live.host);
  const guestIds = (live.guests || []).map(guest => String(guest.user));
  const isPresent = senderId === hostId || guestIds.includes(senderId) ||
    (live.viewers || []).some(viewer => String(viewer.user) === senderId && viewer.heartbeatAt && viewer.heartbeatAt > lease);
  if (!isPresent) throw new Error('Sender is not present in this live broadcast');

  const allowedRecipients = new Set([hostId, ...guestIds]);
  if (live.pk?.isActive && live.pk.rivalRoomId && live.pk.rivalHost) {
    const rival = await LiveBroadcast.findOne({ _id: live.pk.rivalRoomId, host: live.pk.rivalHost,
      status: 'live', heartbeatAt: { $gt: lease } }).select('host').lean();
    if (rival) allowedRecipients.add(String(rival.host));
  }
  if (receivers.some(receiver => !allowedRecipients.has(String(receiver._id || receiver.id)))) {
    throw new Error('Recipient is not a host or accepted guest in this live broadcast');
  }
  return null;
}
