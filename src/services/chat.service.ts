import { Types } from "mongoose";
import Conversation, { IConversation } from "../models/conversation.model";
import Message, { IMessage } from "../models/chat.model";
import redis from "../configs/redisConfig";
import { getOrCreateConversationPair } from "../utils/conversationPair";
import { withDistributedLock } from "../utils/distributedLock";
import { CoinsTransaction } from "../models/spentCoinModel";
import { CallStatus, TransactionType } from "../constants/user";
import { User } from "../models/user.model";

// Send message
export const sendMessage = async ({
    senderId,
    receiverId,
    content,
    conversationId,
    messageId,
}: {
    senderId: string | Types.ObjectId;
    receiverId: string | Types.ObjectId;
    content: string;
    conversationId?: string | Types.ObjectId;
    messageId?: string | Types.ObjectId;
}): Promise<{ message: IMessage; conversation: IConversation | null }> => {
    const conversation = conversationId
        ? await Conversation.findOne({
            _id: conversationId,
            participants: { $all: [senderId, receiverId], $size: 2 },
        }) as IConversation | null
        : await getOrCreateConversation(senderId, receiverId);

    if (!conversation) throw new Error("Conversation not found for these users");

    // ✅ Save the message
    const message = (await Message.create({
        ...(messageId ? { _id: messageId } : {}),
        conversationId: conversation._id,
        sender: senderId,
        receiver: receiverId,
        content,
    })) as IMessage;

    // ✅ Update lastMessage in conversation
    conversation.lastMessage = message._id as Types.ObjectId;
    await conversation.save();

    // ✅ Populate lastMessage and participants before returning
    const updatedConversation = await Conversation.findById(conversation._id)
        .populate("lastMessage")
        .populate("participants", "name image _id");

    return { message, conversation: updatedConversation };
};

export const getOrCreateConversation = async (
    firstUserId: string | Types.ObjectId,
    secondUserId: string | Types.ObjectId,
): Promise<IConversation> => {
    const participants = [new Types.ObjectId(String(firstUserId)), new Types.ObjectId(String(secondUserId))];
    return getOrCreateConversationPair(String(participants[0]), String(participants[1]), {
        find: async (ids) => Conversation.findOne({
            participants: { $all: ids.map((id) => new Types.ObjectId(id)), $size: 2 },
        }) as Promise<IConversation | null>,
        create: async (ids) => Conversation.create({
            participants: ids.map((id) => new Types.ObjectId(id)),
        }) as Promise<IConversation>,
        withLock: (key, task) => withDistributedLock(redis, key, task, {
            ttlMs: 10_000,
            waitMs: 3_000,
        }),
    });
};

// Get messages by conversationId
export const getMessages = async (
    conversationId: string | Types.ObjectId,
    limit = 50,
    skip = 0
): Promise<IMessage[]> => {
    const convId = new Types.ObjectId(conversationId);
    return await Message.find({ conversationId: convId })
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit);
};

// Get conversation list for a user
export const getConversations = async (
    userId: string | Types.ObjectId
): Promise<any[]> => {
    const uid = new Types.ObjectId(userId);

    // Retain conversation discovery for users who met the older call-to-chat
    // eligibility threshold before conversation creation was made explicit.
    try {
        const eligiblePartners = await CoinsTransaction.aggregate([
            {
                $match: {
                    $or: [{ userId: uid }, { hostId: uid }],
                    status: CallStatus.ENDED,
                    type: TransactionType.VOICE_CALL
                }
            },
            {
                $group: {
                    _id: {
                        $cond: [
                            { $eq: ["$userId", uid] },
                            "$hostId",
                            "$userId"
                        ]
                    },
                    totalDuration: { $sum: "$duration" }
                }
            },
            { $match: { totalDuration: { $gte: 120 } } } // 2 minutes (Testing)
        ]);

        const conversations = await Conversation.find({ participants: uid });
        const existingPartnerIds = conversations.map(c =>
            c.participants.find(p => p.toString() !== uid.toString())?.toString()
        ).filter(id => id);

        for (const partner of eligiblePartners) {
            if (!existingPartnerIds.includes(partner._id.toString())) {
                await getOrCreateConversation(uid, partner._id);
                existingPartnerIds.push(partner._id.toString());
            }
        }
    } catch (discoveryError) {
        console.error("Chat discovery error:", discoveryError);
    }

    const conversations = await Conversation.find({
        participants: uid,
    })
        .populate("participants", "name image _id lastOnline")
        .populate("lastMessage");

    // ⚡ Fetch Online Users from Redis (Scalable)
    const onlineUserIds = await redis.smembers("online_users");
    const onlineSet = new Set(onlineUserIds);

    const currentUser = await User.findById(uid).select("blockedUsers");
    const myBlocklist = currentUser?.blockedUsers?.map((id: any) => id.toString()) || [];

    // 👇 participants me isOnline inject kar rahe
    // Filter only for blocklists. Private conversations are available from
    // their profile or inbox without requiring a completed call first.
    const filteredConversations = await Promise.all(conversations.map(async (conv) => {
        try {
            // Find the other participant
            const otherParticipant = conv.participants.find((p: any) => p._id.toString() !== uid.toString());

            if (!otherParticipant) return null;

            // Check if blocked by current user
            if (myBlocklist.includes(otherParticipant._id.toString())) {
                return null;
            }

            // Check if other user blocked current user
            const otherUserDoc = await User.findById(otherParticipant._id).select("blockedUsers");
            const theirBlocklist = otherUserDoc?.blockedUsers?.map((id: any) => id.toString()) || [];
            if (theirBlocklist.includes(uid.toString())) {
                return null;
            }

            // Return formatted conversation
            const participantsWithStatus = conv.participants.map((p: any) => ({
                ...p.toObject(),
                isOnline: onlineSet.has(p._id.toString()),
            }));

            // Get unread count for current user
            const unreadCount = await Message.countDocuments({
                conversationId: conv._id,
                receiver: uid,
                status: { $ne: "seen" }
            });

            return {
                ...conv.toObject(),
                participants: participantsWithStatus,
                unreadCount,
            };
        } catch (err) {
            console.error("Error processing conversation filter:", err);
            return null; // Skip invalid conversations instead of crashing
        }
    }));

    // Filter out nulls
    return filteredConversations.filter(c => c !== null);
}

// Mark messages seen
export const markMessagesSeen = async (
    conversationId: string | Types.ObjectId,
    userId: string | Types.ObjectId
): Promise<void> => {
    const convId = new Types.ObjectId(conversationId);
    const uid = new Types.ObjectId(userId);

    await Message.updateMany(
        { conversationId: convId, receiver: uid, status: { $ne: "seen" } },
        { $set: { status: "seen" } }
    );
};

// Delete seen messages
export const deleteSeenMessages = async (
    conversationId: string | Types.ObjectId,
    userId: string | Types.ObjectId
): Promise<void> => {
    const convId = new Types.ObjectId(conversationId);
    const uid = new Types.ObjectId(userId);

    await Message.deleteMany({
        conversationId: convId,
        receiver: uid,
        status: "seen",
    });
};
