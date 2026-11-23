import { Request, Response } from 'express';
import { User } from '../models/user.model';
import { Request as RequestModel, RequestStatus } from '../models/request.model';
import { AuditLog } from '../models/auditLog.model';
import { AuthRequest } from '../middlewares/authorize.middleware';
import sendResponse from '../utils/reponse';
import { generateSecureHash } from '../utils/passwordHelper';
import { generateToken, generateUniqueId } from '../utils/generator';
import { generateSpecialCode, generateStrongPassword, logActivity } from './emsController';
import mongoose from 'mongoose';
import { HierarchyScopeService } from '../utils/hierarchyScope';
import { config } from "../configs/envConfig";
import { AuthType, Gender, UserRole } from "../constants/user";
import { Logger } from "../utils/logger";
import { IdentityEntitlement } from '../models/identityEntitlement.model';
import Message from '../models/chat.model';
import Conversation from '../models/conversation.model';
import { Room } from '../models/room.model';
import redis from '../configs/redisConfig';
import { checkIdTaken } from './uniqueIdRequest.controller';

// initialize super admin (seeding logic called on startup)
export const initializeSuperAdmin = async (): Promise<void> => {
  try {
    const {
      SUPER_ADMIN_EMAIL,
      SUPER_ADMIN_PASSWORD,
      SUPER_ADMIN_PHONE,
      SUPER_ADMIN_ROLE,
    } = config;

    if (!SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
      throw new Error("Super admin credentials missing in env");
    }

    const existingSuperAdmin = await User.findOne({
      $or: [
        { role: { $in: ['owner', UserRole.SUPER_ADMIN] } },
        { email: SUPER_ADMIN_EMAIL.toLowerCase().trim() }
      ],
      isDeleted: false,
    });

    if (existingSuperAdmin) {
      console.log("✅ Super Admin already exists");
      return;
    }

    const hashedPassword = await generateSecureHash(SUPER_ADMIN_PASSWORD);
    const userId = await generateUniqueId();

    await User.create({
      name: "Super Admin",
      userId,
      email: SUPER_ADMIN_EMAIL,
      phoneNumber: SUPER_ADMIN_PHONE || undefined,
      password: hashedPassword,
      role: SUPER_ADMIN_ROLE || UserRole.SUPER_ADMIN,
      authType: AuthType.PHONE,
      gender: Gender.MALE,
      emailVerified: true,
      phoneVerified: true,
      isActive: true,
      isOnline: false,
      isBlocked: false,
      device: {
        createdDeviceId: "SYSTEM_INIT",
        currentDeviceId: "SYSTEM_INIT",
        loggedInDeviceIds: ["SYSTEM_INIT"],
      },
      createdBy: null,
    });

    console.log("🚀 Super Admin created successfully");
  } catch (error) {
    await Logger("initializeSuperAdmin", error);
    throw error;
  }
};

// ─── GET: Admin List with aggregations ─────────────────────────────────────────
export const listAdmins = async (req: AuthRequest, res: Response) => {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const actor = req.user!;
    const matchStage: any = {
      $and: [
        HierarchyScopeService.buildUserScope({ id: String(actor.id), role: actor.role }),
        { role: 'admin', isDeleted: false },
      ],
    };
    if (status === 'active') matchStage.isBlocked = false;
    if (status === 'suspended') matchStage.isBlocked = true;
    if (search) {
      const q = new RegExp(String(search), 'i');
      matchStage.$and.push({ $or: [{ name: q }, { email: q }, { phoneNumber: q }] });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [admins, total] = await Promise.all([
      User.find(matchStage)
        .select('userId name email phoneNumber image gender role isBlocked isActive isOnline lastOnline coins diamonds createdAt country specialCode agencyId createdBy')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      User.countDocuments(matchStage),
    ]);

    // Enhance each admin with counts & recruited lists
    const enrichedAdmins = await Promise.all(
      admins.map(async (admin) => {
        const adminObjId = admin._id;

        const [activeAgenciesCount, newAgenciesCount, activeHostsCount, newHostsCount, recruitedAgencies] = await Promise.all([
          User.countDocuments({ role: 'agency', adminId: adminObjId, isBlocked: false, isDeleted: false }),
          User.countDocuments({ role: 'agency', adminId: adminObjId, isDeleted: false, createdAt: { $gte: thirtyDaysAgo } }),
          User.countDocuments({ role: 'host', adminId: adminObjId, isBlocked: false, isDeleted: false }),
          User.countDocuments({ role: 'host', adminId: adminObjId, isDeleted: false, createdAt: { $gte: thirtyDaysAgo } }),
          User.find({ role: 'agency', adminId: adminObjId, isDeleted: false })
            .select('userId name email phoneNumber specialCode referralCode isBlocked createdAt')
            .lean(),
        ]);

        return {
          ...admin,
          coins: (admin as any).diamonds ?? 0,
          beans: (admin as any).coins ?? 0,
          diamonds: (admin as any).diamonds ?? 0,
          activeAgenciesCount,
          newAgenciesCount,
          activeHostsCount,
          newHostsCount,
          recruitedAgencies,
        };
      })
    );

    // Aggregated stats
    const stats = await User.aggregate([
      { $match: { role: 'admin', isDeleted: false } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$isBlocked', false] }, 1, 0] } },
          suspended: { $sum: { $cond: [{ $eq: ['$isBlocked', true] }, 1, 0] } },
          totalCoins: { $sum: '$coins' },
          totalDiamonds: { $sum: '$diamonds' },
        },
      },
    ]);

    return sendResponse(res, 200, true, 'Admins fetched', {
      admins: enrichedAdmins,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      stats: stats[0] || { total: 0, active: 0, suspended: 0, totalCoins: 0, totalDiamonds: 0 },
    });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message);
  }
};

// Helper to build a safe query for _id or userId
const getSafeUserQuery = (id: string, role?: string) => {
  const isObjId = mongoose.Types.ObjectId.isValid(id);
  const numId = Number(id);

  const filter: any = { isDeleted: false };
  if (role) filter.role = role;

  if (isObjId && !isNaN(numId)) {
    filter.$or = [{ _id: id }, { userId: numId }];
  } else if (isObjId) {
    filter._id = id;
  } else if (!isNaN(numId)) {
    filter.userId = numId;
  } else {
    return null;
  }
  return filter;
};

// ─── GET: Single Admin ─────────────────────────────────────────────────────────
export const getAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const query = getSafeUserQuery(id, 'admin');
    if (!query) return sendResponse(res, 404, false, 'Admin not found');

    const admin = await User.findOne(query).lean();
    if (!admin) return sendResponse(res, 404, false, 'Admin not found');
    return sendResponse(res, 200, true, 'Admin fetched', admin);
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message);
  }
};

// ─── PATCH: Toggle Block/Unblock ───────────────────────────────────────────────
export const toggleAdminBlock = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const query = getSafeUserQuery(id, 'admin');
    if (!query) return sendResponse(res, 404, false, 'Admin not found');

    const admin = await User.findOne(query);
    if (!admin) return sendResponse(res, 404, false, 'Admin not found');

    admin.isBlocked = !admin.isBlocked;
    await admin.save();

    await logActivity(
      req.user!.id.toString(), req.user!.role,
      admin.isBlocked ? 'admin_suspended' : 'admin_activated',
      (admin as any)._id.toString(),
      `Admin ${admin.name} ${admin.isBlocked ? 'suspended' : 'activated'}`,
      req.ip || '127.0.0.1'
    );

    return sendResponse(res, 200, true, `Admin ${admin.isBlocked ? 'suspended' : 'activated'}`, { isBlocked: admin.isBlocked });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message);
  }
};

// ─── DELETE: Soft-delete admin ─────────────────────────────────────────────────
export const deleteAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (req.user?.role !== 'owner') return sendResponse(res, 403, false, 'Owner only');

    const query = getSafeUserQuery(id, 'admin');
    if (!query) return sendResponse(res, 404, false, 'Admin not found');

    const admin = await User.findOne(query);
    if (!admin) return sendResponse(res, 404, false, 'Admin not found');

    admin.isDeleted = true;
    await admin.save();

    await logActivity(req.user.id.toString(), req.user.role, 'admin_deleted', id, `Admin ${admin.name} deleted`, req.ip || '127.0.0.1');
    return sendResponse(res, 200, true, 'Admin deleted');
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message);
  }
};

// ─── POST: Reset Password ──────────────────────────────────────────────────────
export const resetAdminPassword = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const query = getSafeUserQuery(id, 'admin');
    if (!query) return sendResponse(res, 404, false, 'Admin not found');

    const admin = await User.findOne(query).select('+password');
    if (!admin) return sendResponse(res, 404, false, 'Admin not found');

    const newPassword = generateStrongPassword();
    admin.password = await generateSecureHash(newPassword);
    await admin.save();

    return sendResponse(res, 200, true, 'Password reset', { newPassword });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message);
  }
};

// ─── GET: Recruited Members for specific parent/role ──────────────────────────────
export const getRecruitedMembers = async (req: Request, res: Response) => {
  try {
    const { parentId, targetRole, search, page = 1, limit = 20 } = req.query;

    const parentIdStr = parentId ? String(parentId).trim() : '';
    let parentUser: any = null;

    if (parentIdStr && parentIdStr !== 'undefined' && parentIdStr !== 'null') {
      if (mongoose.Types.ObjectId.isValid(parentIdStr)) {
        parentUser = await User.findById(parentIdStr).select('userId name email phoneNumber role specialCode referralCode image').lean();
      }
      if (!parentUser && !isNaN(Number(parentIdStr))) {
        parentUser = await User.findOne({ userId: Number(parentIdStr) }).select('userId name email phoneNumber role specialCode referralCode image').lean();
      }

      // If parentId was specified but not found, return empty results safely
      if (!parentUser) {
        return sendResponse(res, 200, true, 'Recruiter not found', {
          parent: null,
          members: [],
          total: 0,
          page: Number(page) || 1,
          limit: Number(limit) || 20,
          totalPages: 0,
          stats: {
            totalRecruited: 0,
            superAdminsCount: 0,
            adminsCount: 0,
            agenciesCount: 0,
            hostsCount: 0,
            activeCount: 0,
            blockedCount: 0,
          }
        });
      }
    }

    const baseConditions: any[] = [];

    if (parentUser) {
      const parentObjId = parentUser._id;
      const orConditions: any[] = [
        { operatorId: parentObjId },
        { superAdminId: parentObjId },
        { adminId: parentObjId },
        { agencyId: parentObjId },
        { parentId: parentObjId },
        { createdBy: parentObjId },
        { referredBy: parentObjId },
      ];
      if (parentUser.specialCode) {
        orConditions.push({ referralCode: parentUser.specialCode });
      }
      if (parentUser.referralCode) {
        orConditions.push({ referralCode: parentUser.referralCode });
      }
      baseConditions.push({ $or: orConditions });
    }

    if (targetRole && targetRole !== 'all') {
      baseConditions.push({ role: targetRole });
    }

    if (search && String(search).trim() !== '') {
      const searchStr = String(search).trim();
      const escapedSearch = searchStr.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, 'i');
      const searchNum = Number(searchStr);
      const searchOrs: any[] = [
        { name: searchRegex },
        { email: searchRegex },
        { userName: searchRegex },
        { phoneNumber: searchRegex },
        { meethiId: searchRegex },
        { employeeCode: searchRegex },
        { specialCode: searchRegex },
        { referralCode: searchRegex },
      ];
      if (!isNaN(searchNum)) {
        searchOrs.push({ userId: searchNum });
      }
      baseConditions.push({ $or: searchOrs });
    }

    if ((req as any).user?.role === 'operator') {
      const ownerInfo = await HierarchyScopeService.getOwnerReferralInfo();
      const exclusionFilter = HierarchyScopeService.buildOwnerReferralExclusionFilter('operator', 'user', ownerInfo);
      if (Object.keys(exclusionFilter).length > 0) {
        baseConditions.push(exclusionFilter);
      }
    }

    const matchStage: any = { isDeleted: false };
    if (baseConditions.length > 0) {
      matchStage.$and = baseConditions;
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 20);
    const skip = (pageNum - 1) * limitNum;

    const [members, total] = await Promise.all([
      User.find(matchStage)
        .select('userId name email phoneNumber image gender role isBlocked isActive isOnline lastOnline coins diamonds createdAt country specialCode referralCode agencyId createdBy parentId operatorId superAdminId adminId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(matchStage),
    ]);

    // Statistics breakdown for parent
    const statsStage: any = { isDeleted: false };
    if (parentUser) {
      const parentObjId = parentUser._id;
      const orConditions: any[] = [
        { operatorId: parentObjId },
        { superAdminId: parentObjId },
        { adminId: parentObjId },
        { agencyId: parentObjId },
        { parentId: parentObjId },
        { createdBy: parentObjId },
        { referredBy: parentObjId },
      ];
      if (parentUser.specialCode) {
        orConditions.push({ referralCode: parentUser.specialCode });
      }
      if (parentUser.referralCode) {
        orConditions.push({ referralCode: parentUser.referralCode });
      }
      statsStage.$or = orConditions;
    }

    const [superAdminsCount, adminsCount, agenciesCount, hostsCount, activeCount, blockedCount] = await Promise.all([
      User.countDocuments({ ...statsStage, role: 'superAdmin' }),
      User.countDocuments({ ...statsStage, role: 'admin' }),
      User.countDocuments({ ...statsStage, role: 'agency' }),
      User.countDocuments({ ...statsStage, role: 'host' }),
      User.countDocuments({ ...statsStage, isBlocked: false }),
      User.countDocuments({ ...statsStage, isBlocked: true }),
    ]);

    const mappedMembers = members.map((m: any) => ({
      ...m,
      coins: m.diamonds ?? 0,
      beans: m.coins ?? 0,
      diamonds: m.diamonds ?? 0,
    }));

    return sendResponse(res, 200, true, 'Recruited members fetched successfully', {
      parent: parentUser ? {
        ...parentUser,
        coins: (parentUser as any).diamonds ?? 0,
        beans: (parentUser as any).coins ?? 0,
        diamonds: (parentUser as any).diamonds ?? 0,
      } : null,
      members: mappedMembers,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      stats: {
        totalRecruited: superAdminsCount + adminsCount + agenciesCount + hostsCount,
        superAdminsCount,
        adminsCount,
        agenciesCount,
        hostsCount,
        activeCount,
        blockedCount,
      }
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Error fetching recruited members');
  }
};

/**
 * 👑 Owner Only: Update or create a custom User ID for any user.
 * Strictly restricted to Platform Owner (role === 'owner').
 */
export const updateCustomUserIdByOwner = async (req: AuthRequest, res: Response) => {
  try {
    const actorRole = String(req.user?.role || '').toLowerCase();
    if (actorRole !== 'owner') {
      return sendResponse(res, 403, false, 'Permission Denied: Only Platform Owner panel can edit or assign custom User IDs.');
    }

    const { id } = req.params;
    const { customId, updateNumericUserId = false } = req.body;
    const cleanId = String(customId || '').trim();

    if (!cleanId) {
      return sendResponse(res, 400, false, 'Custom ID cannot be empty');
    }

    // Find target user by _id, numeric userId, meethiId, or uniqueId
    let userDoc: any = null;
    if (mongoose.Types.ObjectId.isValid(String(id))) {
      userDoc = await User.findById(id);
    }
    if (!userDoc && !isNaN(Number(id))) {
      userDoc = await User.findOne({ userId: Number(id) });
    }
    if (!userDoc) {
      userDoc = await User.findOne({
        $or: [{ customDisplayId: id }, { meethiId: id }, { uniqueId: id }]
      });
    }

    if (!userDoc) {
      return sendResponse(res, 404, false, 'Target user not found');
    }

    // Check if ID is already taken by anyone else
    const { isTaken, existingUser } = await checkIdTaken(cleanId, String(userDoc._id));
    if (isTaken && existingUser && String(existingUser.id) !== String(userDoc._id)) {
      return sendResponse(res, 409, false, `ID "${cleanId}" is already taken by user "${existingUser.name}" (ID: ${existingUser.userId})`);
    }

    // Set custom ID fields
    userDoc.customDisplayId = cleanId;
    userDoc.equippedCustomId = cleanId;
    userDoc.uniqueId = cleanId;
    userDoc.displayId = cleanId;
    userDoc.meethiId = cleanId;

    const numVal = Number(cleanId);
    if (updateNumericUserId && !isNaN(numVal) && Number.isInteger(numVal) && numVal > 0) {
      const existingWithNum = await User.findOne({ userId: numVal, _id: { $ne: userDoc._id } });
      if (existingWithNum) {
        return sendResponse(res, 409, false, `Numeric User ID ${numVal} is already in use by another account.`);
      }
      userDoc.userId = numVal;
    }

    await userDoc.save();

    // Register in IdentityEntitlement for global resolution across voice rooms, rankings, search
    await IdentityEntitlement.findOneAndUpdate(
      {
        userObjectId: userDoc._id,
        type: 'unique_id',
      },
      {
        $set: {
          userId: userDoc.userId,
          userObjectId: userDoc._id,
          type: 'unique_id',
          config: {
            displayId: cleanId,
            badgeName: 'Owner Custom VIP ID',
            badgeIconUrl: '',
          },
          status: 'active',
          grantSource: 'owner_custom_id',
          grantReason: `Custom ID assigned by Owner (${req.user?.name || req.user?.userId || 'Owner'})`,
          startsAt: new Date(),
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000 * 50),
        },
      },
      { upsert: true, new: true }
    );

    // Audit log
    await AuditLog.create({
      action: 'UPDATE_CUSTOM_USER_ID',
      performedBy: (req.user as any)?.id || (req.user as any)?._id || (req.user as any)?.userId,
      targetUser: userDoc._id,
      details: {
        newCustomId: cleanId,
        previousCustomId: userDoc.customDisplayId,
        targetUserId: userDoc.userId,
      },
      timestamp: new Date(),
    }).catch(() => {});

    return sendResponse(res, 200, true, `User ID successfully updated to "${cleanId}" by Owner.`, {
      userId: userDoc.userId,
      customDisplayId: userDoc.customDisplayId,
      equippedCustomId: userDoc.equippedCustomId,
      meethiId: userDoc.meethiId,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Error updating custom user ID');
  }
};

/**
 * 👑 Owner Only: Delete a message by messageId.
 */
export const deleteMessageByOwner = async (req: AuthRequest, res: Response) => {
  try {
    const actorRole = String(req.user?.role || '').toLowerCase();
    if (actorRole !== 'owner') {
      return sendResponse(res, 403, false, 'Permission Denied: Only Owner panel has permission to delete messages.');
    }

    const { id } = req.params;
    if (!id) {
      return sendResponse(res, 400, false, 'Message ID is required');
    }

    const message = await Message.findByIdAndDelete(id);
    if (!message) {
      return sendResponse(res, 404, false, 'Message not found');
    }

    return sendResponse(res, 200, true, 'Message successfully deleted by Owner');
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Error deleting message');
  }
};

/**
 * 👑 Owner Only: Delete an entire conversation/chat and all its messages.
 */
export const deleteConversationByOwner = async (req: AuthRequest, res: Response) => {
  try {
    const actorRole = String(req.user?.role || '').toLowerCase();
    if (actorRole !== 'owner') {
      return sendResponse(res, 403, false, 'Permission Denied: Only Owner panel has permission to delete chats.');
    }

    const { id } = req.params;
    if (!id) {
      return sendResponse(res, 400, false, 'Conversation ID is required');
    }

    await Message.deleteMany({ conversationId: id });
    await Conversation.findByIdAndDelete(id);

    return sendResponse(res, 200, true, 'Chat conversation and all messages deleted successfully by Owner');
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Error deleting conversation');
  }
};

/**
 * 👑 Owner Only: Toggle YouTube Watch Together Access for any user.
 */
export const toggleWatchTogetherAccess = async (req: AuthRequest, res: Response) => {
  try {
    const actorRole = String(req.user?.role || '').toLowerCase();
    if (actorRole !== 'owner') {
      return sendResponse(res, 403, false, 'Permission Denied: Only Owner has permission to manage Watch Together access.');
    }

    const { userId, canWatchTogether } = req.body;
    if (!userId) {
      return sendResponse(res, 400, false, 'User ID is required');
    }

    const target = await User.findOne({
      $or: [
        { userId: String(userId) },
        { meethiId: String(userId) },
        ...(mongoose.Types.ObjectId.isValid(userId) ? [{ _id: userId }] : []),
      ],
    });

    if (!target) {
      return sendResponse(res, 404, false, 'User not found');
    }

    const newState = typeof canWatchTogether === 'boolean' ? canWatchTogether : !(target as any).canWatchTogether;
    (target as any).canWatchTogether = newState;
    await target.save();

    return sendResponse(res, 200, true, `Watch Together access ${newState ? 'granted' : 'revoked'} for ${target.name || target.userId}`, {
      userId: target.userId,
      meethiId: (target as any).meethiId,
      name: target.name,
      canWatchTogether: newState,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Error toggling Watch Together access');
  }
};

/**
 * 👑 Owner Only: Search and list users with Watch Together status.
 */
export const getWatchTogetherUsers = async (req: AuthRequest, res: Response) => {
  try {
    const actorRole = String(req.user?.role || '').toLowerCase();
    if (actorRole !== 'owner') {
      return sendResponse(res, 403, false, 'Permission Denied: Only Owner has permission to view Watch Together users.');
    }

    const query = String(req.query.q || '').trim();
    const filter: any = {};
    if (query) {
      filter.$or = [
        { userId: { $regex: query, $options: 'i' } },
        { meethiId: { $regex: query, $options: 'i' } },
        { name: { $regex: query, $options: 'i' } },
        ...(mongoose.Types.ObjectId.isValid(query) ? [{ _id: query }] : []),
      ];
    } else {
      // By default show users who have access or VIP/SVIP >= 4 or recent 20 users
      filter.$or = [
        { canWatchTogether: true },
        { vipLevel: { $gte: 4 } },
        { svipLevel: { $gte: 4 } },
      ];
    }

    const users = await User.find(filter)
      .select('userId meethiId name avatar image vipLevel svipLevel role canWatchTogether isGlobalRoomManager')
      .limit(50)
      .lean();

    return sendResponse(res, 200, true, 'Watch Together users retrieved', users);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Error fetching Watch Together users');
  }
};

/**
 * 👑 Owner Only: Clean all chat messages and conversations across the entire platform.
 */
export const cleanAllChatsByOwner = async (req: AuthRequest, res: Response) => {
  try {
    const actorRole = String(req.user?.role || '').toLowerCase();
    if (actorRole !== 'owner') {
      return sendResponse(res, 403, false, 'Permission Denied: Only Owner can clean all chats.');
    }

    const msgResult = await Message.deleteMany({});
    const convResult = await Conversation.deleteMany({});

    return sendResponse(res, 200, true, `All chats cleaned successfully (${msgResult.deletedCount || 0} messages, ${convResult.deletedCount || 0} conversations deleted).`);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Error cleaning all chats');
  }
};

/**
 * 👑 Owner Only: Clean chat messages and conversations for a specific user.
 */
export const cleanSingleUserChatsByOwner = async (req: AuthRequest, res: Response) => {
  try {
    const actorRole = String(req.user?.role || '').toLowerCase();
    if (actorRole !== 'owner') {
      return sendResponse(res, 403, false, 'Permission Denied: Only Owner can clean user chats.');
    }

    const { userId } = req.body;
    if (!userId) {
      return sendResponse(res, 400, false, 'User ID is required');
    }

    const targetUser = await User.findOne({
      $or: [
        { userId: String(userId) },
        { meethiId: String(userId) },
        ...(mongoose.Types.ObjectId.isValid(userId) ? [{ _id: userId }] : []),
      ],
    });

    if (!targetUser) {
      return sendResponse(res, 404, false, 'User not found');
    }

    const conversations = await Conversation.find({
      participants: targetUser._id,
    }).select('_id');

    const conversationIds = conversations.map(c => c._id);
    const msgResult = await Message.deleteMany({ conversationId: { $in: conversationIds } });
    const convResult = await Conversation.deleteMany({ _id: { $in: conversationIds } });

    return sendResponse(res, 200, true, `Cleaned chat for ${targetUser.name || targetUser.userId} (${msgResult.deletedCount || 0} messages removed).`);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Error cleaning user chats');
  }
};

/**
 * 👑 Owner Only: Clean all rooms in MongoDB and reset voice room cache in Redis.
 */
export const cleanAllRoomsByOwner = async (req: AuthRequest, res: Response) => {
  try {
    const actorRole = String(req.user?.role || '').toLowerCase();
    if (actorRole !== 'owner') {
      return sendResponse(res, 403, false, 'Permission Denied: Only Owner can clean all rooms.');
    }

    const roomResult = await Room.deleteMany({});
    try {
      const keys = await redis.keys('voice_room:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (_) {}

    return sendResponse(res, 200, true, `All voice rooms cleaned successfully (${roomResult.deletedCount || 0} rooms removed). New rooms will start from 9-digit ID 100000000.`);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Error cleaning all rooms');
  }
};

/**
 * 👑 Owner Only: Assign or update custom room ID for any room.
 */
export const updateCustomRoomIdByOwner = async (req: AuthRequest, res: Response) => {
  try {
    const actorRole = String(req.user?.role || '').toLowerCase();
    if (actorRole !== 'owner') {
      return sendResponse(res, 403, false, 'Permission Denied: Only Owner can assign custom room IDs.');
    }

    const { roomId, customRoomId } = req.body;
    if (!roomId) return sendResponse(res, 400, false, 'Room ID is required');
    if (!customRoomId || !String(customRoomId).trim()) return sendResponse(res, 400, false, 'Custom Room ID is required');

    const cleanCustomId = String(customRoomId).trim();
    const existing = await Room.findOne({
      $or: [
        { channelName: cleanCustomId },
        { customDisplayId: cleanCustomId },
        { uniqueId: cleanCustomId },
      ],
      channelName: { $ne: String(roomId) },
    });

    if (existing) {
      return sendResponse(res, 409, false, `Custom Room ID '${cleanCustomId}' is already in use by room '${existing.title}'.`);
    }

    const room = await Room.findOne({
      $or: [
        { channelName: String(roomId) },
        ...(mongoose.Types.ObjectId.isValid(roomId) ? [{ _id: roomId }] : []),
      ],
    });

    if (!room) return sendResponse(res, 404, false, 'Room not found');

    room.customDisplayId = cleanCustomId;
    room.uniqueId = cleanCustomId;
    await room.save();

    try {
      const key = `voice_room:${cleanCustomId}`;
      const origKey = `voice_room:${room.channelName}`;
      const raw = await redis.get(origKey);
      if (raw) {
        const state = JSON.parse(raw);
        state.uniqueId = cleanCustomId;
        state.displayRoomId = cleanCustomId;
        await redis.set(origKey, JSON.stringify(state), 'EX', 86400);
      }
    } catch (_) {}

    return sendResponse(res, 200, true, `Custom Room ID '${cleanCustomId}' assigned successfully to room '${room.title}'.`, {
      channelName: room.channelName,
      customDisplayId: room.customDisplayId,
      title: room.title,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Error updating custom room ID');
  }
};
