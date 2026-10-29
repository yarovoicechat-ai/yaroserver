import { User } from '../models/user.model';
import { RoomBulletCharge } from '../models/roomBulletCharge.model';
import { atomic } from '../economy/service';
export const BULLET_MESSAGE_DIAMONDS = 1;

export async function chargeRoomBullet(senderId: string, roomId: string, requestId: string, text: string) {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId) || !text.trim() || text.length > 500) throw new Error('Invalid bullet message');
  return atomic(async session => {
    const previous = await RoomBulletCharge.findOne({ senderId, requestId }).session(session).lean();
    if (previous) {
      if (previous.roomId !== roomId || previous.text !== text) throw new Error('Message ID already used');
      const current = await User.findById(senderId).select('diamonds').session(session).lean();
      return { duplicate: true, diamonds: Number(current?.diamonds ?? previous.balanceAfter) };
    }
    const wallet = await User.findOneAndUpdate({ _id: senderId, isBlocked: { $ne: true }, isDeleted: { $ne: true },
      diamonds: { $gte: BULLET_MESSAGE_DIAMONDS } }, { $inc: { diamonds: -BULLET_MESSAGE_DIAMONDS } },
      { new: true, session }).select('diamonds').lean();
    if (!wallet) throw new Error('INSUFFICIENT_DIAMONDS');
    await RoomBulletCharge.create([{ senderId, roomId, requestId, text,
      diamonds: BULLET_MESSAGE_DIAMONDS, balanceAfter: wallet.diamonds }], { session });
    return { duplicate: false, diamonds: Number(wallet.diamonds) };
  });
}
