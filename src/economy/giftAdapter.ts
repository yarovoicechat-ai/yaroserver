import { GiftTransaction } from '../gift/gift.model';
import { broadcastGiftSuccess } from '../gift/gift.socket';
import { User } from '../models/user.model';
import { atomic, PinnedEconomy, processRoomGift } from './service';
import { diamondUnits, mul } from './rules';
import { Room } from '../models/room.model';
import { Types } from 'mongoose';
import { Agency } from '../models/agency.model';

/** Called only after the existing catalog, VIP, sender and recipient checks. */
export async function sendVersionedRoomGift(sender: any, receivers: any[], gift: any, dto: any, qty: number, pinned: PinnedEconomy) {
  if (!/^[A-Za-z0-9_:-]{1,128}$/.test(dto.requestId)) throw new Error('Valid bounded gift requestId required');
  const unitPrice = Number(gift.price ?? gift.cost), unitsPerReceiver = mul(diamondUnits(unitPrice), qty);
  const room = await Room.findOne({ $or: [{ channelName: String(dto.roomId) },
    ...(Types.ObjectId.isValid(String(dto.roomId)) ? [{ _id: dto.roomId }] : [])] }).lean();
  if (!room || room.isBanned) throw new Error('Room is unavailable');
  const { getVoiceRoomState } = await import('../sockets/voiceRoomSocket');
  const state = await getVoiceRoomState(String(room.channelName || dto.roomId));
  const present = Object.keys(state.onlineUsers || {});
  if (![String(sender._id), String(sender.userId)].some(id => present.includes(id))) throw new Error('Sender is not present in this room');
  for (const rec of receivers) if (!state.seats.some(seat => [String(rec._id), String(rec.userId)].includes(String(seat.user?.userId || '')))) throw new Error('Recipient is not hosting in this room');
  const result = await atomic(async session => {
    const old = await GiftTransaction.findOne({ requestId: dto.requestId }).session(session).lean();
    if (old) {
      if (old.status === 'REFUNDED') throw new Error('Gift was already refunded');
      if (String(old.senderId) !== String(sender._id) || old.meta?.economyVersion !== pinned.version ||
        old.meta?.economyFingerprint !== JSON.stringify({ gift: String(gift._id), qty, receivers: receivers.map(r => String(r._id)), room: dto.roomId })) throw new Error('Gift idempotency conflict');
      return { transaction: old, replay: true, data: old.meta.economyPayload };
    }
    const targets = [];
    for (const rec of receivers) {
      const host = await User.findById(rec._id).select('role agencyId isDeleted isBlocked').session(session).lean();
      if (!host || host.role !== 'host' || host.isDeleted || host.isBlocked) throw new Error('V2 room gifts require an eligible host');
      const agency = host.agencyId ? await User.findOne({ _id: host.agencyId, role: 'agency', isBlocked: { $ne: true }, isDeleted: { $ne: true } }).session(session).lean() : null;
      const agencyConfig = agency ? await Agency.findOne({ ownerId: agency._id, status: 'active' }).session(session).lean() : null;
      targets.push({ id: String(rec._id), ...(agencyConfig ? { agency: String(agency!._id),
        agencyBps: Math.min(pinned.rules.gift.agencyMaxBps, diamondUnits(agencyConfig.commissionRate)) } : {}) });
    }
    const financial = await processRoomGift({ key: dto.requestId, sender: String(sender._id), receivers: targets,
      unitsPerReceiver, giftId: String(gift._id), roomId: dto.roomId }, pinned, session);
    const id = new GiftTransaction()._id;
    const payload = {
      transactionId: String(id), requestId: dto.requestId, roomId: dto.roomId, callId: '',
      sender: { id: String(sender._id), userId: sender.userId, name: sender.name, avatar: sender.image || sender.avatar },
      receivers: receivers.map(r => ({ id: String(r._id), userId: r.userId, name: r.name, avatar: r.image || r.avatar })),
      receiver: { id: String(receivers[0]._id), userId: receivers[0].userId, name: receivers[0].name },
      gift: { ...gift.toObject(), id: String(gift._id), price: unitPrice, currency: 'DIAMONDS' },
      quantity: qty, totalDiamonds: financial.totalUnits / 100, comboCount: Number(dto.comboCount) || 1,
      senderBalance: financial.afterUnits / 100, economyVersion: pinned.version,
      receiverBalances: receivers.map(r => ({ userId: String(r._id), diamonds: r.diamonds || 0 })),
      allocations: financial.allocations, timestamp: Date.now(),
    };
    const [transaction] = await GiftTransaction.create([{
      _id: id, requestId: dto.requestId, senderId: sender._id, receiverId: receivers[0]._id,
      receiverIds: receivers.map(r => r._id), roomId: dto.roomId, callId: '', giftId: gift._id,
      quantity: qty, unitPrice, totalDiamonds: financial.totalUnits / 100, totalPrice: financial.totalUnits / 100,
      status: 'SUCCESS', currency: 'DIAMONDS', type: 'GIFT_SEND',
      hostEarning: financial.allocations.reduce((n: number, a: any) => n + a.instant, 0),
      platformCommission: financial.allocations.reduce((n: number, a: any) => n + a.platform, 0),
      commissionPercent: pinned.rules.gift.platformMinBps / 100,
      meta: { economyVersion: pinned.version, rulesDigest: pinned.digest,
        economyFingerprint: JSON.stringify({ gift: String(gift._id), qty, receivers: receivers.map(r => String(r._id)), room: dto.roomId }),
        economyPayload: payload, accounting: financial, earningCurrency: 'BEAN' },
    }], { session });
    return { transaction, replay: false, data: payload };
  });
  if (!result.replay) broadcastGiftSuccess({ ...result.data, transaction: result.transaction });
  return { success: true, isReplay: result.replay, data: result.data, transaction: result.transaction, newBalance: result.data.senderBalance };
}
