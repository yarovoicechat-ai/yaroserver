import { Types } from 'mongoose';
import LiveBroadcast from '../models/liveBroadcast.model';

export async function reserveLiveGuest(roomId: string, hostId: string, guestId: string, agoraUid: number, limit: number) {
  const result = await LiveBroadcast.updateOne(
    {
      _id: roomId,
      host: hostId,
      status: 'live',
      'guests.user': { $ne: new Types.ObjectId(guestId) },
      $expr: { $lt: [{ $size: { $ifNull: ['$guests', []] } }, limit] },
    },
    {
      $push: { guests: { user: new Types.ObjectId(guestId), agoraUid, role: 'guest', joinedAt: new Date() } },
      $pull: { joinRequests: { user: new Types.ObjectId(guestId) } },
    },
  );
  return result.modifiedCount === 1;
}

export async function incrementLiveSupporter(roomId: string, userId: string, amount: number) {
  const user = new Types.ObjectId(userId);
  const increment = () => LiveBroadcast.updateOne(
    { _id: roomId, 'topContributors.user': user },
    { $inc: { 'topContributors.$.amount': amount } },
  );
  const existing = await increment();
  if (existing.matchedCount === 0) {
    const inserted = await LiveBroadcast.updateOne(
      { _id: roomId, 'topContributors.user': { $ne: user } },
      { $push: { topContributors: { user, amount } } },
    );
    // Another gift from this sender may have inserted the row after our first check.
    if (inserted.matchedCount === 0) await increment();
  }
  await LiveBroadcast.updateOne(
    { _id: roomId },
    { $push: { topContributors: { $each: [], $sort: { amount: -1 }, $slice: 10 } } },
  );
}
