import Message from '../models/chat.model';
import Conversation from '../models/conversation.model';
import { User } from '../models/user.model';
import { atomic } from '../economy/service';
import { hostedChatCost } from '../utils/chatPricing';

export async function sendPricedChatMessage(input: { senderId: string; receiverId: string; conversationId: string; content: string; requestId: string }) {
  return atomic(async session => {
    const existing = await Message.findOne({ sender: input.senderId, requestId: input.requestId }).session(session).lean();
    if (existing) {
      if (String(existing.receiver) !== input.receiverId || existing.content !== input.content) throw Error('Request ID already used for another message');
      const wallet = await User.findById(input.senderId).select('diamonds coins').session(session).lean();
      return { message: existing, duplicate: true, diamonds: Number(wallet?.diamonds || 0), coins: Number(wallet?.coins || 0), cost: existing.diamondsCharged || 0 };
    }
    const sender = await User.findById(input.senderId).session(session).lean();
    const receiver = await User.findById(input.receiverId).session(session).lean();
    if (!sender || !receiver || sender.isBlocked || receiver.isBlocked || sender.isDeleted || receiver.isDeleted) throw Error('Chat account unavailable');
    const cost = hostedChatCost(sender, receiver);
    let diamonds = Number(sender.diamonds || 0);
    if (cost) {
      const wallet = await User.findOneAndUpdate({ _id: sender._id, diamonds: { $gte: cost } }, { $inc: { diamonds: -cost } }, { new: true, session }).lean();
      if (!wallet) throw Error('INSUFFICIENT_DIAMONDS');
      diamonds = Number(wallet.diamonds);
    }
    const [message] = await Message.create([{ conversationId: input.conversationId, sender: input.senderId, receiver: input.receiverId,
      content: input.content, type: 'text', requestId: input.requestId, diamondsCharged: cost }], { session });
    const conversation = await Conversation.updateOne({ _id: input.conversationId, participants: { $all: [sender._id, receiver._id] } }, { $set: { lastMessage: message._id } }, { session });
    if (!conversation.matchedCount) throw Error('Conversation unavailable');
    return { message: message.toObject(), duplicate: false, diamonds, coins: Number(sender.coins || 0), cost };
  });
}
