import { Response } from 'express';
import mongoose from 'mongoose';
import Conversation from '../models/conversation.model';
import Message from '../models/chat.model';
import { User } from '../models/user.model';
import { AuditLog } from '../models/auditLog.model';
import { AuthRequest } from '../middlewares/authorize.middleware';
import sendResponse from '../utils/reponse';

/**
 * Owner-only: Get a safe preview before executing Chat Cleanup.
 */
export const getChatCleanupPreview = async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user;
    if (!owner || owner.role !== 'owner') {
      return sendResponse(res, 403, false, 'Forbidden: Owner authorization required.');
    }

    const { mode = 'all', userId } = req.query as { mode?: string; userId?: string };

    if (mode === 'single') {
      if (!userId || !String(userId).trim()) {
        return sendResponse(res, 400, false, 'User ID is required for single user cleanup preview.');
      }

      const searchVal = String(userId).trim();
      const targetUser = await User.findOne({
        $or: [
          ...(Number(searchVal) > 0 ? [{ userId: Number(searchVal) }] : []),
          ...(mongoose.Types.ObjectId.isValid(searchVal) ? [{ _id: new mongoose.Types.ObjectId(searchVal) }] : []),
        ],
      }).select('_id userId name phoneNumber image isBlocked').lean();

      if (!targetUser) {
        return sendResponse(res, 404, false, `User "${userId}" not found.`);
      }

      const conversationCount = await Conversation.countDocuments({
        participants: targetUser._id,
        isArchived: { $ne: true },
        clearedFor: { $ne: targetUser._id },
      });

      const messageCount = await Message.countDocuments({
        $or: [{ sender: targetUser._id }, { receiver: targetUser._id }],
      });

      return sendResponse(res, 200, true, 'Single user chat cleanup preview generated', {
        mode: 'single',
        targetUser: {
          _id: targetUser._id,
          userId: targetUser.userId,
          name: targetUser.name,
          phoneNumber: targetUser.phoneNumber,
        },
        preview: {
          activeConversations: conversationCount,
          totalMessages: messageCount,
        },
        operationId: `PREVIEW_CHAT_SINGLE_${Date.now()}`,
      });
    }

    // Mode: 'all'
    const totalActiveConversations = await Conversation.countDocuments({
      isArchived: { $ne: true },
    });

    const distinctParticipants = await Conversation.distinct('participants', {
      isArchived: { $ne: true },
    });

    const totalMessages = await Message.countDocuments({});

    return sendResponse(res, 200, true, 'Global chat cleanup preview generated', {
      mode: 'all',
      preview: {
        totalActiveConversations,
        affectedUsersCount: distinctParticipants.length,
        totalMessagesInDatabase: totalMessages,
      },
      operationId: `PREVIEW_CHAT_ALL_${Date.now()}`,
    });
  } catch (error: any) {
    console.error('[getChatCleanupPreview] error:', error);
    return sendResponse(res, 500, false, error.message || 'Internal server error');
  }
};

/**
 * Owner-only: Execute Chat Cleanup (Safe removal from active list or explicit permanent deletion).
 */
export const executeChatCleanup = async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user;
    if (!owner || owner.role !== 'owner') {
      return sendResponse(res, 403, false, 'Forbidden: Owner authorization required.');
    }

    const {
      mode = 'all', // 'all' | 'single'
      userId,
      cleanupType = 'clean_active_list', // 'clean_active_list' | 'permanent_delete'
      confirmationToken,
      secondConfirmation, // Required for 'all'
    } = req.body || {};

    if (mode === 'all') {
      if (confirmationToken !== 'CONFIRM_CLEAN_ALL_CHATS') {
        return sendResponse(res, 400, false, 'Safety Check: Primary confirmation token required: "CONFIRM_CLEAN_ALL_CHATS".');
      }
      if (secondConfirmation !== true) {
        return sendResponse(res, 400, false, 'Safety Check: Secondary confirmation flag must be explicitly confirmed for Clean All.');
      }
    }

    if (cleanupType === 'permanent_delete' && confirmationToken !== 'CONFIRM_PERMANENT_DELETE') {
      return sendResponse(res, 400, false, 'Safety Check: Permanent deletion requires confirmation token: "CONFIRM_PERMANENT_DELETE".');
    }

    const opId = `OP_CHAT_CLEANUP_${mode.toUpperCase()}_${Date.now()}`;

    // A. Single User Cleanup
    if (mode === 'single') {
      if (!userId || !String(userId).trim()) {
        return sendResponse(res, 400, false, 'User ID is required for single user cleanup.');
      }

      const searchVal = String(userId).trim();
      const targetUser = await User.findOne({
        $or: [
          ...(Number(searchVal) > 0 ? [{ userId: Number(searchVal) }] : []),
          ...(mongoose.Types.ObjectId.isValid(searchVal) ? [{ _id: new mongoose.Types.ObjectId(searchVal) }] : []),
        ],
      }).select('_id userId name').lean();

      if (!targetUser) {
        return sendResponse(res, 404, false, `User "${userId}" not found.`);
      }

      let affectedConversations = 0;
      let affectedMessages = 0;

      if (cleanupType === 'permanent_delete') {
        const userConversations = await Conversation.find({ participants: targetUser._id }).select('_id').lean();
        const convIds = userConversations.map(c => c._id);
        const delMsgs = await Message.deleteMany({ conversationId: { $in: convIds } });
        const delConvs = await Conversation.deleteMany({ _id: { $in: convIds } });
        affectedConversations = delConvs.deletedCount || 0;
        affectedMessages = delMsgs.deletedCount || 0;
      } else {
        // Safe: remove conversations from active chat list for this user
        const updateResult = await Conversation.updateMany(
          { participants: targetUser._id, clearedFor: { $ne: targetUser._id } },
          { $addToSet: { clearedFor: targetUser._id } }
        );
        affectedConversations = updateResult.modifiedCount || 0;
      }

      await AuditLog.create({
        adminId: owner.id,
        action: `CHAT_CLEANUP_SINGLE_${cleanupType.toUpperCase()}`,
        target: String(targetUser._id),
        details: `Cleaned chat for user "${targetUser.name}" (User ID: ${targetUser.userId || targetUser._id}). Affected convs: ${affectedConversations}`,
        ipAddress: req.ip || '127.0.0.1',
        newValue: { operationId: opId, mode, cleanupType, affectedConversations, affectedMessages },
      });

      return sendResponse(res, 200, true, `Successfully cleaned chat list for user ${targetUser.name}`, {
        operationId: opId,
        mode: 'single',
        cleanupType,
        targetUser: {
          _id: targetUser._id,
          userId: targetUser.userId,
          name: targetUser.name,
        },
        affectedConversations,
        affectedMessages,
      });
    }

    // B. Clean All Users' Chat Lists
    let affectedConversations = 0;
    let affectedMessages = 0;

    if (cleanupType === 'permanent_delete') {
      const delMsgs = await Message.deleteMany({});
      const delConvs = await Conversation.deleteMany({});
      affectedConversations = delConvs.deletedCount || 0;
      affectedMessages = delMsgs.deletedCount || 0;
    } else {
      // Safe default: archive active conversations so chat lists are clean
      const updateResult = await Conversation.updateMany(
        { isArchived: { $ne: true } },
        { $set: { isArchived: true, clearedAt: new Date() } }
      );
      affectedConversations = updateResult.modifiedCount || 0;
    }

    await AuditLog.create({
      adminId: owner.id,
      action: `CHAT_CLEANUP_ALL_${cleanupType.toUpperCase()}`,
      target: 'GLOBAL_CHAT',
      details: `Executed Clean All Chats (${cleanupType}). Affected conversations: ${affectedConversations}`,
      ipAddress: req.ip || '127.0.0.1',
      newValue: { operationId: opId, mode, cleanupType, affectedConversations, affectedMessages },
    });

    return sendResponse(res, 200, true, `Successfully executed Clean All Chats. ${affectedConversations} conversations cleared.`, {
      operationId: opId,
      mode: 'all',
      cleanupType,
      affectedConversations,
      affectedMessages,
    });
  } catch (error: any) {
    console.error('[executeChatCleanup] error:', error);
    return sendResponse(res, 500, false, error.message || 'Internal server error');
  }
};
