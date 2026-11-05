import { Response } from "express";
import {
  sendMessage,
  getMessages,
  getConversations,
  markMessagesSeen,
  deleteSeenMessages,
  getOrCreateConversation,
} from "../services/chat.service";
import { AuthRequest } from "../middlewares/authorize.middleware";
import sendResponse from "../utils/reponse";
import { Logger } from "../utils/logger";

import { getIO, onlineUsers, getUserRoom } from "../sockets"; // export your io instance from chatSocket or a separate file

import { ChatQueueService } from "../services/chatQueue.service";
import { Types } from "mongoose";
import { User } from "../models/user.model";
import Conversation from "../models/conversation.model";
import { updateBalance } from "../services/coins.service";
import { getCachedSettings } from "./settingsController";
import {
  validateMessageContent,
  handleModerationViolation,
} from "../services/messageModerationService";
import { evaluateModerationEscalation } from "../services/moderationEscalationService";
import { ChatViolation } from "../models/chatViolation.model";
import { sendPushNotification } from '../utils/pushNotification';
import { randomUUID } from 'crypto';
import { sendPricedChatMessage } from '../services/hostedChat.service';

const resolveChatUserId = async (value: unknown): Promise<string | null> => {
  const identifier = String(value || '').trim();
  if (!identifier) return null;
  let target: any = Types.ObjectId.isValid(identifier) ? await User.findById(identifier).select('_id').lean() : null;
  if (!target) {
    const numericId = /^\d+$/.test(identifier) ? Number(identifier) : undefined;
    target = await User.findOne({
      $or: [
        ...(numericId === undefined ? [] : [{ userId: numericId }]),
        { meethiId: identifier },
      ],
      isDeleted: { $ne: true },
    }).select('_id').lean();
  }
  return target?._id ? String(target._id) : null;
};

const usersCanChat = async (firstUserId: string, secondUserId: string) => {
  const [first, second] = await Promise.all([
    User.findById(firstUserId).select('blockedUsers').lean(),
    User.findById(secondUserId).select('blockedUsers').lean(),
  ]);
  const firstBlocked = (first?.blockedUsers || []).some((id: any) => String(id) === secondUserId);
  const secondBlocked = (second?.blockedUsers || []).some((id: any) => String(id) === firstUserId);
  return Boolean(first && second && !firstBlocked && !secondBlocked);
};

export const createConversationController = async (req: AuthRequest, res: Response) => {
  try {
    const senderId = String(req.user?.id || req.user?.userId || '');
    const receiverId = await resolveChatUserId(req.body?.receiverId || req.body?.userId || req.body?.recipientId);
    if (!Types.ObjectId.isValid(senderId) || !receiverId) {
      return sendResponse(res, 400, false, 'A valid recipient is required');
    }
    if (senderId === receiverId) return sendResponse(res, 400, false, 'You cannot start a chat with yourself');
    if (!(await usersCanChat(senderId, receiverId))) {
      return sendResponse(res, 403, false, 'Chat is unavailable because one account has blocked the other.');
    }
    const conversation = await getOrCreateConversation(senderId, receiverId);
    return sendResponse(res, 200, true, 'Conversation ready', { conversation });
  } catch (error: any) {
    await Logger('createConversationController', error);
    return sendResponse(res, 500, false, error.message || 'Could not open conversation');
  }
};

export const sendMessageController = async (req: AuthRequest, res: Response) => {
  try {
    const { id, userId: reqUserId, role } = req.user || {};
    const userId = id || reqUserId;
    const { content } = req.body;
    const targetReceiverId = req.body.receiverId || req.body.receiver || req.body.recipientId;

    if (!userId || !targetReceiverId || !content) {
      return sendResponse(res, 400, false, "Missing required fields");
    }
    if (!Types.ObjectId.isValid(String(userId))) {
      return sendResponse(res, 401, false, 'User session is invalid');
    }
    const receiverId = await resolveChatUserId(targetReceiverId);
    if (!receiverId) return sendResponse(res, 404, false, 'Recipient not found');
    if (String(userId) === receiverId) return sendResponse(res, 400, false, 'You cannot message yourself');
    if (!(await usersCanChat(String(userId), receiverId))) {
      return sendResponse(res, 403, false, 'Chat is unavailable because one account has blocked the other.');
    }
    const conversation = await getOrCreateConversation(String(userId), receiverId);
    const conversationId = String(conversation._id);

    // 🚫 CHAT MUTE ENFORCEMENT (Check if sender account is currently muted)
    const senderUser = await User.findById(userId);
    if (senderUser && senderUser.chatMuteUntil && new Date(senderUser.chatMuteUntil).getTime() > Date.now()) {
      return res.status(400).json({
        success: false,
        code: "CHAT_TEMPORARILY_RESTRICTED",
        message: "Your chat access is temporarily restricted.",
        chatMuteUntil: senderUser.chatMuteUntil,
      });
    }

    const settings = await getCachedSettings();
    const MAX_MESSAGE_LIMIT = settings.chatMessageLimit || 50;

    // 📏 DYNAMIC MESSAGE LENGTH CHECK
    if (content.length > MAX_MESSAGE_LIMIT) {
      return res.status(400).json({
        success: false,
        code: "MESSAGE_TOO_LONG",
        message: `1 message me maximum ${MAX_MESSAGE_LIMIT} characters hi bhej sakte hain.`,
      });
    }

    // Gift receipts are generated by the gift service. Client text cannot bypass billing/moderation.
    const isGiftMessage = false;

    // 🛡️ CHAT CONTENT MODERATION CHECK (Skip for system generated gift notifications)
    if (!isGiftMessage) {
      const moderationResult = validateMessageContent(content);
      if (!moderationResult.allowed) {
        const violation = await handleModerationViolation({
          senderId: userId as any,
          receiverId,
          content,
          moderationResult,
          source: "REST",
          conversationId,
        });

        // Trigger automatic escalation evaluation (idempotent)
        await evaluateModerationEscalation(String(userId), String(violation._id));

        // Update Trust & Safety Risk Score & Level (idempotent)
        const { updateUserModerationRisk } = await import("../services/moderationRiskService");
        await updateUserModerationRisk(String(userId), String(violation._id)).catch(err =>
          console.warn("Failed to update user moderation risk:", err?.message)
        );

        return res.status(400).json({
          success: false,
          code: "CHAT_CONTENT_VIOLATION",
          message: "Sharing phone numbers, IDs, links, or contact information is not allowed.",
        });
      }
    }

    const requestId = String(req.body.requestId || randomUUID());
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) return sendResponse(res, 400, false, 'Invalid message request ID');
    // Persist message and Diamond debit together; retries return the same message.
    const delivery = await sendPricedChatMessage({ senderId: String(userId), receiverId, conversationId, content, requestId });
    const mockMessage = delivery.message;
    getIO().to(getUserRoom(String(userId))).emit('balanceUpdated', {
      diamonds: delivery.diamonds, coins: delivery.coins, userId: String(userId),
    });
    if (delivery.duplicate) return sendResponse(res, 200, true, 'Message already sent', {
      message: mockMessage, conversation: { _id: conversationId }, diamonds: delivery.diamonds, messageCost: delivery.cost,
    });

    const receiverRoom = getUserRoom(receiverId);
    getIO().to(receiverRoom).emit("newMessageNotification", {
      conversationId,
      message: mockMessage,
    });

    User.findById(receiverId).select('fcmToken').lean().then(async receiver => {
      if (!receiver?.fcmToken) return;
      const sender = await User.findById(userId).select('name image').lean();
      await sendPushNotification([receiver.fcmToken], {
        title: sender?.name || 'New message',
        body: content.length > 90 ? `${content.slice(0, 87)}...` : content,
        data: {
          type: 'message',
          action: 'open_chat',
          conversationId,
          senderId: String(userId),
          senderName: sender?.name || 'User',
          senderImage: sender?.image || '',
        },
      });
    }).catch(error => console.error('Message push failed:', error.message));

    return sendResponse(res, 201, true, "Message sent", {
      message: mockMessage,
      conversation: { _id: conversationId },
      diamonds: delivery.diamonds,
      messageCost: delivery.cost,
    });
  } catch (error: any) {
    await Logger("sendMessageController", error);
    if (error?.message === 'INSUFFICIENT_DIAMONDS') return sendResponse(res, 400, false, '2 Diamonds required per message to a call host.', undefined, undefined, 'INSUFFICIENT_DIAMONDS');
    return sendResponse(res, 500, false, error.message);
  }
};



// Get messages by conversationId
export const getMessagesController = async (req: AuthRequest, res: Response) => {
  try {
    const { conversationId } = req.query;
    const { limit = "50", skip = "0" } = req.query;

    if (!conversationId) {
      return sendResponse(res, 400, false, "conversationId is required");
    }
    const requesterId = String(req.user?.id || req.user?.userId || '');
    if (!Types.ObjectId.isValid(String(conversationId)) || !await Conversation.exists({
      _id: String(conversationId),
      participants: requesterId,
    })) {
      return sendResponse(res, 403, false, "Conversation not found or access denied");
    }

    const messages = await getMessages(
      String(conversationId),
      Number(limit),
      Number(skip)
    );

    return sendResponse(res, 200, true, "Messages fetched successfully", { messages });
  } catch (error: any) {
    await Logger("getMessagesController", error);
    return sendResponse(res, 500, false, error.message);
  }
};

// Get conversation list for a user
export const getConversationsController = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.user || {};

    if (!id) {
      return sendResponse(res, 400, false, "userId is required");
    }

    const conversations = await getConversations(id);

    if (!conversations || conversations.length === 0) {
      return res.status(200).json({ data: [] }); // 200 OK + empty array
    }
    return sendResponse(res, 200, true, "Conversations fetched successfully", {
      conversations,
    });
  } catch (error: any) {
    await Logger("getConversationsController", error);
    return sendResponse(res, 500, false, error.message);
  }
};

// Mark messages seen
export const markMessagesSeenController = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.user || {};
    const { conversationId } = req.body;

    if (!id || !conversationId) {
      return sendResponse(res, 400, false, "conversationId and userId required");
    }

    if (!Types.ObjectId.isValid(String(conversationId)) || !await Conversation.exists({ _id: conversationId, participants: id })) {
      return sendResponse(res, 403, false, "Conversation not found or access denied");
    }

    const messageIds = Array.isArray(req.body.messageIds) ? req.body.messageIds.slice(0, 200).map(String) : undefined;
    const unreadCount = await markMessagesSeen(conversationId, id, messageIds);
    getIO().to(getUserRoom(String(id))).emit('chatUnreadUpdated', { conversationId, unreadCount });
    getIO().to(String(conversationId)).emit('messagesSeen', { conversationId, id: String(id), messageIds });
    return sendResponse(res, 200, true, "Messages marked as seen", { unreadCount });
  } catch (error: any) {
    await Logger("markMessagesSeenController", error);
    return sendResponse(res, 500, false, error.message);
  }
};

// Delete seen messages
export const deleteSeenMessagesController = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.user || {};
    const { conversationId } = req.body;

    if (!id || !conversationId) {
      return sendResponse(res, 400, false, "conversationId and userId required");
    }

    if (!Types.ObjectId.isValid(String(conversationId)) || !await Conversation.exists({ _id: conversationId, participants: id })) {
      return sendResponse(res, 403, false, "Conversation not found or access denied");
    }

    await deleteSeenMessages(conversationId, id);
    return sendResponse(res, 200, true, "Seen messages deleted");
  } catch (error: any) {
    await Logger("deleteSeenMessagesController", error);
    return sendResponse(res, 500, false, error.message);
  }
};
