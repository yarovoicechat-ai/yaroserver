import { Server } from 'socket.io';
import { getIO } from '../sockets';

const normalizeRoomId = (id: string): string => {
  const clean = String(id || '').trim();
  if (/^10000\d{3}$/.test(clean)) {
    const lastDigits = clean.slice(5);
    return `100000000${lastDigits}`.slice(-10);
  }
  return clean;
};

export interface BroadcastGiftParams {
  transaction?: any;
  transactionId?: string;
  requestId?: string;
  sender: any;
  receivers: any[];
  gift: any;
  quantity: number;
  totalDiamonds?: number;
  comboCount: number;
  roomId?: string;
  callId?: string;
  senderBalance?: any;
  receiverBalances?: any[];
}

export const broadcastGiftSuccess = (params: BroadcastGiftParams) => {
  const io: Server = getIO();
  if (!io) {
    console.warn('[GiftSocket] Socket.IO server instance not ready yet');
    return;
  }

  const {
    transaction,
    transactionId,
    requestId,
    sender,
    receivers,
    gift,
    quantity,
    totalDiamonds,
    comboCount,
    roomId,
    callId,
    senderBalance,
    receiverBalances,
  } = params;

  const senderSummary = {
    id: String(sender._id || sender.id),
    userId: sender.userId,
    name: sender.name || 'User',
    avatar: sender.image || sender.avatar || 'https://api.yaroapp.in/uploads/avatars/female_default.webp',
  };

  const receiversSummary = receivers.map((r) => ({
    id: String(r._id || r.id),
    userId: r.userId,
    name: r.name || 'Recipient',
    avatar: r.image || r.avatar || 'https://api.yaroapp.in/uploads/avatars/female_default.webp',
    seatIndex: r.seatIndex !== undefined ? r.seatIndex : null,
  }));

  const giftSummary = {
    id: String(gift._id || gift.id),
    name: gift.name,
    icon: gift.icon,
    image: gift.image || (gift.icon?.startsWith('http') ? gift.icon : '') || gift.previewUrl || '',
    giftImage: gift.image || (gift.icon?.startsWith('http') ? gift.icon : '') || gift.previewUrl || '',
    giftIcon: gift.icon,
    animationUrl: gift.animationUrl || '',
    previewUrl: gift.previewUrl || '',
    animationType: gift.animationType || 'NORMAL',
    duration: gift.duration || 2500,
    rarity: gift.rarity || 'common',
    price: gift.price !== undefined ? gift.price : gift.cost,
  };

  const resolvedDiamonds = Number(
    totalDiamonds !== undefined
      ? totalDiamonds
      : (transaction?.totalDiamonds !== undefined
          ? transaction.totalDiamonds
          : (transaction?.totalPrice !== undefined
              ? transaction.totalPrice
              : (giftSummary.price * quantity * Math.max(1, receiversSummary.length))))
  );

  const basePayload = {
    transactionId: String(transaction?._id || transaction?.id || transactionId || `tx_${Date.now()}`),
    requestId: transaction?.requestId || requestId || `req_${Date.now()}`,
    roomId: roomId || '',
    callId: callId || '',
    sender: senderSummary,
    receivers: receiversSummary,
    receiver: receiversSummary[0] || null, // Backwards compatibility for single-receiver readers
    gift: giftSummary,
    giftImage: giftSummary.image,
    giftIcon: giftSummary.icon,
    quantity,
    totalDiamonds: resolvedDiamonds,
    totalPrice: resolvedDiamonds,
    currency: 'DIAMONDS',
    comboCount: comboCount || 1,
    timestamp: Date.now(),
  };

  const animationPayload = {
    animationId: `anim_${transaction?._id || Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    animationType: giftSummary.animationType,
    duration: giftSummary.duration,
    gift: giftSummary,
    sender: senderSummary,
    receivers: receiversSummary,
    quantity,
    comboCount: comboCount || 1,
    timestamp: Date.now(),
  };

  // 1. Broadcast to Voice Room Channels
  if (roomId) {
    const canonicalId = normalizeRoomId(roomId);
    const channels = [
      `voice_room_channel:${canonicalId}`,
      `room:${canonicalId}`,
    ];
    if (canonicalId !== roomId) {
      channels.push(`voice_room_channel:${roomId}`);
      channels.push(`room:${roomId}`);
    }

    const roomBroadcast = io.to(channels);
    roomBroadcast.emit('gift:received', basePayload);
    roomBroadcast.emit('gift:animation', animationPayload);
    if (receivers.length > 1) {
      roomBroadcast.emit('gift:batch', {
        ...basePayload,
        isBatch: true,
        receiverCount: receivers.length,
      });
    }
  }

  // 2. Broadcast to In-Call Channels
  if (callId) {
    const callRoom = `call:${callId}`;
    io.to(callRoom).emit('gift:received', basePayload);
    io.to(callRoom).emit('gift:animation', animationPayload);
  }

  // 3. Emit targeted gift:sent to Sender rooms
  const senderRooms = [
    `user:${senderSummary.id}`,
    ...(senderSummary.userId ? [`user:${senderSummary.userId}`] : []),
  ];
  senderRooms.forEach((room) => {
    io.to(room).emit('gift:sent', basePayload);
    if (senderBalance !== undefined && senderBalance !== null) {
      const diamondsVal = typeof senderBalance === 'number'
        ? senderBalance
        : Number(senderBalance.diamonds ?? senderBalance.totalDiamonds ?? 0);
      io.to(room).emit('balanceUpdated', {
        userId: senderSummary.id,
        diamonds: diamondsVal,
        totalBalance: diamondsVal,
      });
    }
  });

  // 4. Emit targeted gift:received and balanceUpdated to each Receiver
  receivers.forEach((rec, idx) => {
    const rId = String(rec._id || rec.id);
    const recRooms = [
      `user:${rId}`,
      ...(rec.userId ? [`user:${rec.userId}`] : []),
    ];
    recRooms.forEach((room) => {
      io.to(room).emit('gift:received', basePayload);
      const recBal = receiverBalances?.[idx];
      if (recBal !== undefined && recBal !== null) {
        const diamondsVal = typeof recBal === 'number'
          ? recBal
          : Number(recBal.diamonds ?? recBal.totalDiamonds ?? 0);
        io.to(room).emit('balanceUpdated', {
          userId: rId,
          diamonds: diamondsVal,
          totalBalance: diamondsVal,
        });
      }
    });
  });

  console.log(
    `[GiftSocket] 🎁 Broadcasted gift "${gift.name}" x${quantity} from ${senderSummary.name} to ${receivers.length} recipient(s) in room ${roomId || 'N/A'}`
  );
};
