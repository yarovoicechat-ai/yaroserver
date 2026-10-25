import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/user.model';
import { IdentityEntitlement } from '../models/identityEntitlement.model';
import { IdentityEffect } from '../models/identityEffect.model';
import { AssetLibraryItem } from '../models/assetLibrary.model';
import { IdentityAuditLog } from '../models/identityAuditLog.model';
import { SvipTier } from '../models/svipTier.model';
import { VipId } from '../models/vipId.model';
import { IdentityResolverService } from '../services/identityResolver.service';
import sendResponse from '../utils/reponse';
import { AuthRequest } from '../middlewares/authorize.middleware';
import { Logger } from '../utils/logger';

import { NAME_EFFECT_PRESETS, nameEffectExpiry } from '../utils/nameEffectPresets';
import { publishNameEffectUpdate } from '../services/nameEffectUpdate.service';

const ensureNameEffectPresets = () => IdentityEffect.bulkWrite(NAME_EFFECT_PRESETS.map(preset => ({
  updateOne: { filter: { slug: preset.slug }, update: { $setOnInsert: preset }, upsert: true },
})));

/* =========================================================================
   PUBLIC / USER ENDPOINTS
========================================================================= */

export const getEffectiveIdentity = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const resolved = await IdentityResolverService.resolveEffectiveIdentity(userId);
    if (!resolved) {
      return sendResponse(res, 404, false, 'User identity not found');
    }
    return sendResponse(res, 200, true, 'Effective identity resolved', resolved);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Error resolving identity');
  }
};

export const getMyIdentity = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');

    const resolved = await IdentityResolverService.resolveEffectiveIdentity(userId);
    if (!resolved) {
      return sendResponse(res, 404, false, 'User identity not found');
    }
    return sendResponse(res, 200, true, 'User identity fetched', resolved);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Error fetching identity');
  }
};

export const searchUsersWithIdentity = async (req: any, res: Response) => {
  try {
    const query = String(req.query.q || req.query.query || '').trim();
    if (!query) {
      return sendResponse(res, 200, true, 'No query provided', { users: [] });
    }

    const isAdmin = Boolean(req.user?.role && ['owner', 'operator', 'superAdmin', 'admin'].includes(req.user.role));
    const users = await IdentityResolverService.searchUsers(query, {
      limit: parseInt(req.query.limit as string) || 20,
      isAdmin,
    });

    return sendResponse(res, 200, true, `Found ${users.length} matching users`, { users });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Search failed');
  }
};

export const getIdentityCatalog = async (_req: Request, res: Response) => {
  try {
    await ensureNameEffectPresets();

    const [nameEffects, svipTiers, vipPackages] = await Promise.all([
      IdentityEffect.find({ status: 'active', isPurchasable: true, category: { $in: ['animated_name', 'name_color'] } }).sort({ sortOrder: 1 }).lean(),
      SvipTier.find({ isActive: true }).sort({ level: 1 }).lean(),
      VipId.find({ isActive: true }).sort({ vipLevel: 1 }).lean(),
    ]);

    return sendResponse(res, 200, true, 'Identity catalog fetched', {
      nameEffects,
      svipTiers,
      vipPackages,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to fetch catalog');
  }
};

/* =========================================================================
   ADMIN OFFICIAL ID MANAGEMENT
========================================================================= */

export const grantOfficialId = async (req: AuthRequest, res: Response) => {
  try {
    const {
      userIdentifier,
      displayId = 'Official',
      badgeText = 'OFFICIAL',
      badgeUrl = '',
      badgeAnimationType = 'gold_rotate',
      badgeColors = ['#F59E0B', '#D97706'],
      durationDays = 30,
      reason = 'Official YARO Platform Representative',
      notes = '',
    } = req.body;

    if (!userIdentifier) {
      return sendResponse(res, 400, false, 'User identifier is required');
    }

    // Lookup user by numeric ID, username, or Mongo ID
    let targetUser: any = null;
    if (!isNaN(Number(userIdentifier))) {
      targetUser = await User.findOne({ userId: Number(userIdentifier), isDeleted: false });
    }
    if (!targetUser && mongoose.Types.ObjectId.isValid(userIdentifier)) {
      targetUser = await User.findOne({ _id: userIdentifier, isDeleted: false });
    }
    if (!targetUser) {
      targetUser = await User.findOne({ userName: userIdentifier, isDeleted: false });
    }

    if (!targetUser) {
      return sendResponse(res, 404, false, 'Target user not found');
    }

    const permanentNumericId = Number(targetUser.userId);
    const days = Math.max(1, Number(durationDays) || 30);
    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + days * 24 * 60 * 60 * 1000);

    // Collision check: Is this displayId already actively assigned to another user?
    const existingActive = await IdentityEntitlement.findOne({
      type: 'official_id',
      'config.displayId': displayId,
      status: 'active',
      userId: { $ne: permanentNumericId },
      expiresAt: { $gt: startsAt },
    });

    if (existingActive) {
      return sendResponse(
        res,
        409,
        false,
        `Official display ID "${displayId}" is already actively assigned to User ID ${existingActive.userId}`
      );
    }

    // Deactivate previous official_id entitlements for this user
    await IdentityEntitlement.updateMany(
      { userId: permanentNumericId, type: 'official_id', status: 'active' },
      { $set: { status: 'expired' } }
    );

    // Create new entitlement record with server-authoritative timestamps
    const entitlement = await IdentityEntitlement.create({
      userId: permanentNumericId,
      userObjectId: targetUser._id,
      type: 'official_id',
      config: {
        displayId: displayId.trim(),
        badgeText: badgeText.trim(),
        badgeUrl,
        badgeAnimationType,
        badgeColors,
        showVerifiedCheck: true,
      },
      status: 'active',
      startsAt,
      expiresAt,
      grantedBy: {
        adminId: (req.user as any)?._id || req.user?.id,
        adminName: req.user?.name || (req.user as any)?.userName || 'Admin',
        role: req.user?.role || 'admin',
      },
      grantSource: 'admin_grant',
      grantReason: reason,
      notes,
    });

    // Record immutable audit log
    await IdentityAuditLog.create({
      action: 'grant_entitlement',
      targetUserId: permanentNumericId,
      targetUserObjectId: targetUser._id,
      targetUserName: targetUser.userName || targetUser.name,
      entitlementType: 'official_id',
      details: {
        displayId,
        durationDays: days,
        expiresAt,
        badgeText,
      },
      performedBy: {
        adminId: (req.user as any)?._id || req.user?.id,
        adminName: req.user?.name || (req.user as any)?.userName || 'Admin',
        role: req.user?.role || 'admin',
      },
    });

    // Resolve and return effective identity
    const resolvedIdentity = await IdentityResolverService.resolveEffectiveIdentity(permanentNumericId);

    return sendResponse(res, 201, true, `Official ID "${displayId}" granted to ${targetUser.name || permanentNumericId} for ${days} days!`, {
      entitlement,
      resolvedIdentity,
    });
  } catch (error: any) {
    await Logger('grantOfficialId', error);
    return sendResponse(res, 500, false, error.message || 'Failed to grant official ID');
  }
};

export const revokeOfficialId = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const numId = Number(userId);

    const revoked = await IdentityEntitlement.updateMany(
      { userId: numId, type: 'official_id', status: 'active' },
      { $set: { status: 'revoked' } }
    );

    await IdentityAuditLog.create({
      action: 'revoke_entitlement',
      targetUserId: numId,
      entitlementType: 'official_id',
      details: { reason: req.body?.reason || 'Revoked by admin' },
      performedBy: {
        adminId: (req.user as any)?._id || req.user?.id,
        adminName: req.user?.name || (req.user as any)?.userName || 'Admin',
        role: req.user?.role || 'admin',
      },
    });

    // Resolve effective identity — user immediately falls back to permanent numeric ID!
    const fallbackIdentity = await IdentityResolverService.resolveEffectiveIdentity(numId);

    return sendResponse(
      res,
      200,
      true,
      `Official ID revoked. User identity automatically reverted to permanent ID ${numId}`,
      fallbackIdentity
    );
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to revoke official ID');
  }
};

export const listOfficialIds = async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const { status, search } = req.query as any;

    const query: any = { type: 'official_id' };
    if (status === 'active') {
      query.status = 'active';
      query.startsAt = { $lte: now };
      query.expiresAt = { $gt: now };
    } else if (status === 'expired') {
      query.$or = [{ status: 'expired' }, { expiresAt: { $lte: now } }];
    }

    if (search) {
      query.$or = [
        { 'config.displayId': { $regex: search, $options: 'i' } },
        { userId: !isNaN(Number(search)) ? Number(search) : -1 },
      ];
    }

    const entitlements = await IdentityEntitlement.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('userObjectId', 'name userName image userId email')
      .lean();

    return sendResponse(res, 200, true, 'Official IDs fetched', {
      total: entitlements.length,
      entitlements,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to list official IDs');
  }
};

/* =========================================================================
   ADMIN UNIQUE / VANITY ID MANAGEMENT
========================================================================= */

export const listUniqueIds = async (req: Request, res: Response) => {
  try {
    const { search = '', status = 'all', page = 1, limit = 50 } = req.query as any;
    const query: any = { type: 'custom_display_id' };
    const now = new Date();

    if (status === 'active') {
      query.status = 'active';
      query.startsAt = { $lte: now };
      query.expiresAt = { $gt: now };
    } else if (status === 'expired') {
      query.$or = [{ status: 'expired' }, { expiresAt: { $lte: now } }];
    } else if (status === 'revoked') {
      query.status = 'revoked';
    }

    if (search) {
      const searchStr = String(search).trim();
      const numSearch = Number(searchStr);
      const orConditions: any[] = [
        { 'config.displayId': { $regex: searchStr, $options: 'i' } },
      ];
      if (!isNaN(numSearch)) {
        orConditions.push({ userId: numSearch });
      }

      // Also search by username or display name
      const matchingUsers = await User.find({
        $or: [
          { userName: { $regex: searchStr, $options: 'i' } },
          { name: { $regex: searchStr, $options: 'i' } },
        ],
      })
        .select('userId')
        .limit(50)
        .lean();

      if (matchingUsers.length > 0) {
        orConditions.push({ userId: { $in: matchingUsers.map((u: any) => u.userId) } });
      }

      query.$and = (query.$and || []).concat([{ $or: orConditions }]);
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Math.min(200, Number(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [ids, total, badges] = await Promise.all([
      IdentityEntitlement.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('userObjectId', 'name userName image userId email')
        .lean(),
      IdentityEntitlement.countDocuments(query),
      IdentityEntitlement.find({ type: 'unique_id_badge' }).sort({ createdAt: -1 }).lean(),
    ]);

    const latestBadgeByUser = new Map<number, any>();
    badges.forEach((badge: any) => {
      if (!latestBadgeByUser.has(badge.userId)) latestBadgeByUser.set(badge.userId, badge);
    });

    return sendResponse(res, 200, true, 'Unique IDs fetched', {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      entitlements: ids.map((id: any) => ({
        ...id,
        badgeEntitlement: latestBadgeByUser.get(id.userId) || null,
      })),
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to list unique IDs');
  }
};

export const listUniqueIdLevels = async (_req: Request, res: Response) => {
  try {
    const levels = await IdentityEffect.find({ category: 'unique_badge' }).sort({ sortOrder: 1, createdAt: 1 }).lean();
    return sendResponse(res, 200, true, 'Unique ID levels fetched', { levels });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to list unique ID levels');
  }
};

export const createUniqueIdLevel = async (req: AuthRequest, res: Response) => {
  try {
    const { name, levelNumber, badgeName = 'VIP ID', badgeIconUrl, animationType = 'svga', description = '' } = req.body || {};
    const level = Number(levelNumber);
    if (!String(name || '').trim() || !Number.isInteger(level) || level < 1 || !String(badgeIconUrl || '').trim()) {
      return sendResponse(res, 400, false, 'Level name, positive level number, and uploaded badge asset are required');
    }
    const slug = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `unique-id-level-${level}`;
    const duplicateLevel = await IdentityEffect.findOne({ category: 'unique_badge', $or: [{ slug }, { sortOrder: level }] }).lean();
    if (duplicateLevel) return sendResponse(res, 409, false, 'A VIP ID level with this name or level number already exists');
    if (!['svga', 'gif', 'webp', 'pulse', 'shimmer', 'glow', 'static'].includes(String(animationType))) {
      return sendResponse(res, 400, false, 'Unsupported badge animation type');
    }
    const created = await IdentityEffect.create({
      name: String(name).trim(),
      slug,
      category: 'unique_badge',
      description: String(description).trim(),
      config: { levelNumber: level, vipLevel: level, badgeName: String(badgeName).trim() || 'VIP ID', badgeIconUrl: String(badgeIconUrl).trim(), animationType },
      previewBg: 'dark',
      eligibleTiers: ['all'],
      isPurchasable: false,
      priceDiamonds: 0,
      validityDays: 0,
      status: 'active',
      sortOrder: level,
    });
    await IdentityAuditLog.create({
      action: 'create_effect',
      details: { category: 'unique_badge', levelNumber: level, slug, badgeIconUrl },
      performedBy: {
        adminId: (req.user as any)?._id || req.user?.id,
        adminName: req.user?.name || (req.user as any)?.userName || 'Admin',
        role: req.user?.role || 'admin',
      },
    });
    return sendResponse(res, 201, true, 'Unique ID level created', { level: created });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to create unique ID level');
  }
};

export const updateUniqueIdLevel = async (req: AuthRequest, res: Response) => {
  try {
    const levelDoc = await IdentityEffect.findOne({ _id: req.params.id, category: 'unique_badge' });
    if (!levelDoc) return sendResponse(res, 404, false, 'Unique ID level not found');
    const { name, levelNumber, badgeName, badgeIconUrl, animationType, description, status } = req.body || {};
    const nextName = name === undefined ? levelDoc.name : String(name).trim();
    if (!nextName) return sendResponse(res, 400, false, 'Level name is required');
    const nextLevelNumber = levelNumber === undefined
      ? Number(levelDoc.config?.levelNumber || levelDoc.config?.vipLevel || levelDoc.sortOrder || 1)
      : Number(levelNumber);
    if (!Number.isInteger(nextLevelNumber) || nextLevelNumber < 1) return sendResponse(res, 400, false, 'Level number must be a positive integer');
    const nextSlug = nextName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || levelDoc.slug;
    const duplicateLevel = await IdentityEffect.findOne({
      _id: { $ne: levelDoc._id },
      category: 'unique_badge',
      $or: [{ slug: nextSlug }, { sortOrder: nextLevelNumber }],
    }).lean();
    if (duplicateLevel) return sendResponse(res, 409, false, 'A VIP ID level with this name or level number already exists');
    if (animationType !== undefined && !['svga', 'gif', 'webp', 'pulse', 'shimmer', 'glow', 'static'].includes(String(animationType))) {
      return sendResponse(res, 400, false, 'Unsupported badge animation type');
    }
    if (name !== undefined) {
      levelDoc.name = nextName;
      levelDoc.slug = nextSlug;
    }
    if (levelNumber !== undefined) {
      levelDoc.sortOrder = nextLevelNumber;
      levelDoc.config.levelNumber = nextLevelNumber;
      levelDoc.config.vipLevel = nextLevelNumber;
    }
    if (badgeName !== undefined) levelDoc.config.badgeName = String(badgeName).trim();
    if (badgeIconUrl !== undefined) levelDoc.config.badgeIconUrl = String(badgeIconUrl).trim();
    if (animationType !== undefined) levelDoc.config.animationType = String(animationType) as any;
    if (description !== undefined) levelDoc.description = String(description).trim();
    if (status === 'active' || status === 'inactive') levelDoc.status = status;
    await levelDoc.save();
    return sendResponse(res, 200, true, 'Unique ID level updated', { level: levelDoc });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to update unique ID level');
  }
};

export const deleteUniqueIdLevel = async (req: AuthRequest, res: Response) => {
  try {
    const removed = await IdentityEffect.findOneAndDelete({ _id: req.params.id, category: 'unique_badge' });
    if (!removed) return sendResponse(res, 404, false, 'Unique ID level not found');
    return sendResponse(res, 200, true, 'Unique ID level removed; existing grants retain their uploaded badge');
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to remove unique ID level');
  }
};

export const grantUniqueId = async (req: AuthRequest, res: Response) => {
  try {
    const {
      userIdentifier,
      displayId,
      uniqueLevelId,
      durationDays = 30,
      reason = 'Unique ID granted by admin',
      notes = '',
    } = req.body || {};

    if (!userIdentifier || !displayId || !uniqueLevelId) {
      return sendResponse(res, 400, false, 'User, unique ID, and a configured level are required');
    }
    const uniqueLevel: any = await IdentityEffect.findOne({ _id: uniqueLevelId, category: 'unique_badge', status: 'active' }).lean();
    if (!uniqueLevel?.config?.badgeIconUrl) return sendResponse(res, 404, false, 'Configured unique ID level or badge asset not found');
    const badgeName = uniqueLevel.config.badgeName || uniqueLevel.name || 'VIP ID';
    const badgeUrl = uniqueLevel.config.badgeIconUrl;
    const animationType = uniqueLevel.config.animationType || 'svga';
    const vipLevel = Number(uniqueLevel.config.levelNumber || uniqueLevel.config.vipLevel || 1);
    const cleanDisplayId = String(displayId).trim().toUpperCase();
    if (!/^[A-Z0-9]{3,12}$/.test(cleanDisplayId)) {
      return sendResponse(res, 400, false, 'Unique ID must be 3–12 letters or numbers');
    }
    if (/^\d+$/.test(cleanDisplayId) && await User.exists({ userId: Number(cleanDisplayId) })) {
      return sendResponse(res, 409, false, `Unique ID ${cleanDisplayId} conflicts with a permanent user ID`);
    }

    const identifier = String(userIdentifier).trim();
    let targetUser: any = null;
    if (!isNaN(Number(identifier))) {
      targetUser = await User.findOne({ userId: Number(identifier), isDeleted: false });
    }
    if (!targetUser && mongoose.Types.ObjectId.isValid(identifier)) {
      targetUser = await User.findOne({ _id: identifier, isDeleted: false });
    }
    if (!targetUser) targetUser = await User.findOne({ userName: identifier, isDeleted: false });
    if (!targetUser) return sendResponse(res, 404, false, 'Target user not found');

    const permanentNumericId = Number(targetUser.userId);
    const startsAt = new Date();
    const days = Math.max(1, Math.min(730, Number(durationDays) || 30));
    const expiresAt = new Date(startsAt.getTime() + days * 24 * 60 * 60 * 1000);
    const collision = await IdentityEntitlement.findOne({
      type: { $in: ['official_id', 'custom_display_id'] },
      'config.displayId': { $regex: `^${cleanDisplayId}$`, $options: 'i' },
      status: 'active',
      startsAt: { $lte: startsAt },
      expiresAt: { $gt: startsAt },
      userId: { $ne: permanentNumericId },
    }).lean();
    if (collision) {
      return sendResponse(res, 409, false, `ID ${cleanDisplayId} is already assigned to another user`);
    }

    await IdentityEntitlement.updateMany(
      { userId: permanentNumericId, type: { $in: ['custom_display_id', 'unique_id_badge'] }, status: 'active' },
      { $set: { status: 'expired' } },
    );

    const grantInfo = {
      adminId: (req.user as any)?._id || req.user?.id,
      adminName: req.user?.name || (req.user as any)?.userName || 'Admin',
      role: req.user?.role || 'admin',
    };
    const entitlementData = {
      userId: permanentNumericId,
      userObjectId: targetUser._id,
      status: 'active',
      startsAt,
      expiresAt,
      grantedBy: grantInfo,
      grantSource: 'admin_grant',
      grantReason: String(reason).trim(),
      notes: String(notes).trim(),
    };
    const [idEntitlement, badgeEntitlement] = await Promise.all([
      IdentityEntitlement.create({
        ...entitlementData,
        type: 'custom_display_id',
        config: { displayId: cleanDisplayId, vipLevel: Math.max(1, Number(vipLevel) || 1) },
      }),
      IdentityEntitlement.create({
        ...entitlementData,
        type: 'unique_id_badge',
        config: {
          displayId: cleanDisplayId,
          badgeName: String(badgeName).trim() || 'VIP ID',
          badgeIconUrl: String(badgeUrl).trim(),
          animationType: String(animationType || 'svga'),
          vipLevel: Math.max(1, vipLevel),
          levelId: String(uniqueLevel._id),
        },
      }),
    ]);

    await IdentityAuditLog.create({
      action: 'grant_entitlement',
      targetUserId: permanentNumericId,
      targetUserObjectId: targetUser._id,
      targetUserName: targetUser.userName || targetUser.name,
      entitlementType: 'custom_display_id',
      details: { displayId: cleanDisplayId, vipLevel: Number(vipLevel) || 1, durationDays: days, expiresAt, badgeUrl },
      performedBy: grantInfo,
    });

    const resolvedIdentity = await IdentityResolverService.resolveEffectiveIdentity(permanentNumericId);
    return sendResponse(res, 201, true, `Unique ID ${cleanDisplayId} granted for ${days} days`, {
      entitlement: idEntitlement,
      badgeEntitlement,
      resolvedIdentity,
    });
  } catch (error: any) {
    await Logger('grantUniqueId', error);
    return sendResponse(res, 500, false, error.message || 'Failed to grant unique ID');
  }
};

export const revokeUniqueId = async (req: AuthRequest, res: Response) => {
  try {
    const numericUserId = Number(req.params.userId);
    if (!Number.isFinite(numericUserId)) return sendResponse(res, 400, false, 'Valid user ID is required');

    await IdentityEntitlement.updateMany(
      { userId: numericUserId, type: { $in: ['custom_display_id', 'unique_id_badge'] }, status: 'active' },
      { $set: { status: 'revoked' } },
    );
    await User.updateOne({ userId: numericUserId }, { $set: { uniqueId: '' } });

    await IdentityAuditLog.create({
      action: 'revoke_entitlement',
      targetUserId: numericUserId,
      entitlementType: 'custom_display_id',
      details: { reason: req.body?.reason || 'Unique ID revoked by admin' },
      performedBy: {
        adminId: (req.user as any)?._id || req.user?.id,
        adminName: req.user?.name || (req.user as any)?.userName || 'Admin',
        role: req.user?.role || 'admin',
      },
    });
    const resolvedIdentity = await IdentityResolverService.resolveEffectiveIdentity(numericUserId);
    return sendResponse(res, 200, true, `Unique ID revoked; permanent ID ${numericUserId} is active again`, resolvedIdentity);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to revoke unique ID');
  }
};

export const adjustUniqueIdValidity = async (req: AuthRequest, res: Response) => {
  try {
    const numericUserId = Number(req.params.userId);
    if (!Number.isFinite(numericUserId)) return sendResponse(res, 400, false, 'Valid user ID is required');

    const { daysDelta, newExpiresAt, isPermanent, reason = 'Validity adjusted by admin' } = req.body || {};

    const entitlements = await IdentityEntitlement.find({
      userId: numericUserId,
      type: { $in: ['custom_display_id', 'unique_id_badge'] },
    });

    if (!entitlements || entitlements.length === 0) {
      return sendResponse(res, 404, false, 'No unique ID record found for this user');
    }

    const now = new Date();
    let calculatedExpiresAt: Date;

    if (isPermanent) {
      // 100 years in future
      calculatedExpiresAt = new Date(now.getTime() + 100 * 365 * 24 * 60 * 60 * 1000);
    } else if (newExpiresAt) {
      const parsed = new Date(newExpiresAt);
      if (isNaN(parsed.getTime())) {
        return sendResponse(res, 400, false, 'Invalid expiration date provided');
      }
      calculatedExpiresAt = parsed;
    } else if (daysDelta !== undefined && daysDelta !== null) {
      const deltaNumber = Number(daysDelta);
      if (isNaN(deltaNumber)) {
        return sendResponse(res, 400, false, 'Invalid days delta provided');
      }

      // Base date: if adding days to an expired item, start from now; otherwise start from current expiresAt
      const primaryItem = entitlements.find(e => e.type === 'custom_display_id') || entitlements[0];
      const currentExpiry = primaryItem.expiresAt instanceof Date ? primaryItem.expiresAt : new Date(primaryItem.expiresAt);
      const baseDate = deltaNumber > 0 && currentExpiry < now ? now : currentExpiry;

      calculatedExpiresAt = new Date(baseDate.getTime() + deltaNumber * 24 * 60 * 60 * 1000);
    } else {
      return sendResponse(res, 400, false, 'Please specify daysDelta, newExpiresAt, or isPermanent');
    }

    const nextStatus = calculatedExpiresAt > now ? 'active' : 'expired';

    for (const item of entitlements) {
      item.expiresAt = calculatedExpiresAt;
      item.status = nextStatus;
      await item.save();
    }

    // Keep User.uniqueId synchronized
    const idItem = entitlements.find(e => e.type === 'custom_display_id');
    if (idItem?.config?.displayId) {
      await User.updateOne(
        { userId: numericUserId },
        { $set: { uniqueId: nextStatus === 'active' ? idItem.config.displayId : '' } }
      );
    }

    await IdentityAuditLog.create({
      action: 'extend_entitlement',
      targetUserId: numericUserId,
      entitlementType: 'custom_display_id',
      details: {
        daysDelta,
        newExpiresAt: calculatedExpiresAt,
        isPermanent: Boolean(isPermanent),
        status: nextStatus,
        reason,
      },
      performedBy: {
        adminId: (req.user as any)?._id || req.user?.id,
        adminName: req.user?.name || (req.user as any)?.userName || 'Admin',
        role: req.user?.role || 'admin',
      },
    });

    const resolvedIdentity = await IdentityResolverService.resolveEffectiveIdentity(numericUserId);

    return sendResponse(res, 200, true, `Unique ID validity updated. New expiry: ${calculatedExpiresAt.toISOString()}`, {
      expiresAt: calculatedExpiresAt,
      status: nextStatus,
      resolvedIdentity,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to adjust validity');
  }
};

export const removeUniqueId = async (req: AuthRequest, res: Response) => {
  try {
    const numericUserId = Number(req.params.userId);
    if (!Number.isFinite(numericUserId)) return sendResponse(res, 400, false, 'Valid user ID is required');

    const deletePermanently = req.body?.deletePermanently === true || req.query?.deletePermanently === 'true';
    const reason = req.body?.reason || req.query?.reason || 'Unique ID removed by admin';

    if (deletePermanently) {
      await IdentityEntitlement.deleteMany({
        userId: numericUserId,
        type: { $in: ['custom_display_id', 'unique_id_badge'] },
      });
    } else {
      await IdentityEntitlement.updateMany(
        { userId: numericUserId, type: { $in: ['custom_display_id', 'unique_id_badge'] } },
        { $set: { status: 'revoked' } }
      );
    }

    await User.updateOne({ userId: numericUserId }, { $set: { uniqueId: '' } });

    await IdentityAuditLog.create({
      action: 'revoke_entitlement',
      targetUserId: numericUserId,
      entitlementType: 'custom_display_id',
      details: {
        permanentlyDeleted: Boolean(deletePermanently),
        reason,
      },
      performedBy: {
        adminId: (req.user as any)?._id || req.user?.id,
        adminName: req.user?.name || (req.user as any)?.userName || 'Admin',
        role: req.user?.role || 'admin',
      },
    });

    const resolvedIdentity = await IdentityResolverService.resolveEffectiveIdentity(numericUserId);

    return sendResponse(
      res,
      200,
      true,
      `Unique ID removed. User reverted to permanent ID ${numericUserId}`,
      resolvedIdentity
    );
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to remove unique ID');
  }
};

export const updateUniqueIdDetails = async (req: AuthRequest, res: Response) => {
  try {
    const numericUserId = Number(req.params.userId);
    if (!Number.isFinite(numericUserId)) return sendResponse(res, 400, false, 'Valid user ID is required');

    const { displayId, uniqueLevelId, notes } = req.body || {};

    const idEntitlement = await IdentityEntitlement.findOne({
      userId: numericUserId,
      type: 'custom_display_id',
    });

    if (!idEntitlement) {
      return sendResponse(res, 404, false, 'Unique ID record not found for this user');
    }

    if (displayId) {
      const cleanDisplayId = String(displayId).trim().toUpperCase();
      if (!/^[A-Z0-9]{3,12}$/.test(cleanDisplayId)) {
        return sendResponse(res, 400, false, 'Unique ID must be 3–12 letters or numbers');
      }

      if (/^\d+$/.test(cleanDisplayId) && (Number(cleanDisplayId) !== numericUserId) && (await User.exists({ userId: Number(cleanDisplayId) }))) {
        return sendResponse(res, 409, false, `Unique ID ${cleanDisplayId} conflicts with an existing permanent user ID`);
      }

      const collision = await IdentityEntitlement.findOne({
        type: { $in: ['official_id', 'custom_display_id'] },
        'config.displayId': { $regex: `^${cleanDisplayId}$`, $options: 'i' },
        status: 'active',
        userId: { $ne: numericUserId },
      }).lean();

      if (collision) {
        return sendResponse(res, 409, false, `ID ${cleanDisplayId} is already in use by another user`);
      }

      idEntitlement.config.displayId = cleanDisplayId;
      await idEntitlement.save();

      await IdentityEntitlement.updateMany(
        { userId: numericUserId, type: 'unique_id_badge' },
        { $set: { 'config.displayId': cleanDisplayId } }
      );

      await User.updateOne({ userId: numericUserId }, { $set: { uniqueId: cleanDisplayId } });
    }

    if (uniqueLevelId) {
      const levelDoc: any = await IdentityEffect.findOne({ _id: uniqueLevelId, category: 'unique_badge' }).lean();
      if (levelDoc) {
        await IdentityEntitlement.updateMany(
          { userId: numericUserId, type: 'unique_id_badge' },
          {
            $set: {
              'config.badgeName': levelDoc.config?.badgeName || levelDoc.name || 'VIP ID',
              'config.badgeIconUrl': levelDoc.config?.badgeIconUrl || '',
              'config.animationType': levelDoc.config?.animationType || 'svga',
              'config.vipLevel': Number(levelDoc.config?.levelNumber || levelDoc.config?.vipLevel || 1),
              'config.levelId': String(levelDoc._id),
            },
          }
        );
      }
    }

    if (notes !== undefined) {
      idEntitlement.notes = String(notes).trim();
      await idEntitlement.save();
    }

    const resolvedIdentity = await IdentityResolverService.resolveEffectiveIdentity(numericUserId);
    return sendResponse(res, 200, true, 'Unique ID updated successfully', resolvedIdentity);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to update unique ID details');
  }
};

/* =========================================================================
   ANIMATED NAMES & NAME COLORS STUDIO
========================================================================= */

export const listNameEffects = async (_req: Request, res: Response) => {
  try {
    await ensureNameEffectPresets();
    const effects = await IdentityEffect.find({ category: { $in: ['animated_name', 'name_color'] } }).sort({ sortOrder: 1 }).lean();
    return sendResponse(res, 200, true, 'Name effects fetched', { effects });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to list name effects');
  }
};

export const createNameEffect = async (req: AuthRequest, res: Response) => {
  try {
    const data = req.body;
    if (!data.name || !data.slug) {
      return sendResponse(res, 400, false, 'Name and slug are required');
    }

    const created = await IdentityEffect.create({
      ...data,
      category: data.category || 'animated_name',
    });

    await IdentityAuditLog.create({
      action: 'create_effect',
      details: { slug: created.slug, name: created.name },
      performedBy: {
        adminId: (req.user as any)?._id || req.user?.id,
        adminName: req.user?.name || (req.user as any)?.userName || 'Admin',
        role: req.user?.role || 'admin',
      },
    });

    return sendResponse(res, 201, true, 'Identity effect created successfully', created);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to create effect');
  }
};

export const updateNameEffect = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updated = await IdentityEffect.findByIdAndUpdate(id, req.body, { new: true });
    if (!updated) return sendResponse(res, 404, false, 'Effect not found');

    return sendResponse(res, 200, true, 'Identity effect updated', updated);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to update effect');
  }
};

export const deleteNameEffect = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await IdentityEffect.findByIdAndDelete(id);
    if (!deleted) return sendResponse(res, 404, false, 'Effect not found');

    return sendResponse(res, 200, true, 'Identity effect deleted');
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to delete effect');
  }
};

export const grantNameEffectToUser = async (req: AuthRequest, res: Response) => {
  try {
    const { userIdentifier, effectSlug, durationDays = 30 } = req.body;
    let expiresAt: Date;
    try { expiresAt = nameEffectExpiry(durationDays); }
    catch (error: any) { return sendResponse(res, 400, false, error.message); }
    if (!String(userIdentifier || '').trim()) return sendResponse(res, 400, false, 'Target user ID is required');
    const effect = await IdentityEffect.findOne({ slug: effectSlug, status: 'active', category: { $in: ['animated_name', 'name_color'] } });
    if (!effect) return sendResponse(res, 404, false, 'Identity effect not found or inactive');

    const targetUser = await User.findOne({
      $or: [
        { userId: !isNaN(Number(userIdentifier)) ? Number(userIdentifier) : -1 },
        { userName: userIdentifier },
        ...(mongoose.Types.ObjectId.isValid(userIdentifier) ? [{ _id: userIdentifier }] : []),
      ],
      isDeleted: false,
    });

    if (!targetUser) return sendResponse(res, 404, false, 'Target user not found');

    const startsAt = new Date();


    // Deactivate previous name effect
    await IdentityEntitlement.updateMany(
      { userId: targetUser.userId, type: { $in: ['animated_name', 'name_color'] }, status: 'active' },
      { $set: { status: 'expired' } }
    );

    const entitlement = await IdentityEntitlement.create({
      userId: targetUser.userId,
      userObjectId: targetUser._id,
      type: 'animated_name',
      config: {
        styleId: effect.slug,
        ...effect.config,
      },
      status: 'active',
      startsAt,
      expiresAt,
      grantedBy: {
        adminId: (req.user as any)?._id || req.user?.id,
        adminName: req.user?.name || (req.user as any)?.userName || 'Admin',
        role: req.user?.role || 'admin',
      },
      grantSource: 'admin_grant',
      grantReason: `Granted ${effect.name} by admin`,
    });

    await IdentityAuditLog.create({
      action: 'grant_entitlement', targetUserId: targetUser.userId, targetUserObjectId: targetUser._id,
      targetUserName: targetUser.name, entitlementType: 'animated_name',
      details: { entitlementId: entitlement._id, effectSlug: effect.slug, durationDays },
      performedBy: entitlement.grantedBy,
    });
    await publishNameEffectUpdate(targetUser);
    return sendResponse(res, 201, true, `Animated Name "${effect.name}" granted successfully!`, entitlement);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to grant name effect');
  }
};

/* =========================================================================
   ASSET LIBRARY MANAGEMENT
========================================================================= */

export const listAssetLibrary = async (req: Request, res: Response) => {
  try {
    const { category, fileType, search } = req.query as any;
    const query: any = { status: { $ne: 'archived' } };

    if (category && category !== 'all') query.category = category;
    if (fileType && fileType !== 'all') query.fileType = fileType;
    if (search) query.name = { $regex: search, $options: 'i' };

    const assets = await AssetLibraryItem.find(query).sort({ createdAt: -1 }).lean();
    return sendResponse(res, 200, true, 'Assets fetched successfully', {
      total: assets.length,
      assets,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to list assets');
  }
};

export const registerAsset = async (req: AuthRequest, res: Response) => {
  try {
    const {
      name,
      slug,
      category,
      fileUrl,
      thumbnailUrl,
      fileType,
      fileSize = 0,
      dimensions = { width: 0, height: 0 },
      durationMs = 0,
      isLooping = true,
      transparentBg = true,
      tags = [],
    } = req.body;

    if (!name || !fileUrl || !category || !fileType) {
      return sendResponse(res, 400, false, 'Name, fileUrl, category, and fileType are required');
    }

    const uniqueSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const asset = await AssetLibraryItem.create({
      name,
      slug: uniqueSlug,
      category,
      fileUrl,
      thumbnailUrl: thumbnailUrl || fileUrl,
      fileType,
      fileSize,
      dimensions,
      durationMs,
      isLooping,
      transparentBg,
      compatiblePlatforms: ['android', 'ios', 'web'],
      tags,
    });

    await IdentityAuditLog.create({
      action: 'upload_asset',
      details: { slug: asset.slug, fileType: asset.fileType, fileUrl: asset.fileUrl },
      performedBy: {
        adminId: (req.user as any)?._id || req.user?.id,
        adminName: req.user?.name || (req.user as any)?.userName || 'Admin',
        role: req.user?.role || 'admin',
      },
    });

    return sendResponse(res, 201, true, 'Asset registered in library', asset);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to register asset');
  }
};

export const deleteAsset = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await AssetLibraryItem.findByIdAndDelete(id);
    if (!deleted) return sendResponse(res, 404, false, 'Asset not found');

    return sendResponse(res, 200, true, 'Asset deleted from library');
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to delete asset');
  }
};

/* =========================================================================
   USER ENTITLEMENTS MASTER DIRECTORY & AUDIT LOGS
========================================================================= */

export const listAllEntitlements = async (req: Request, res: Response) => {
  try {
    const { type, status, userId, page = 1, limit = 50 } = req.query as any;
    const query: any = {};

    if (type && type !== 'all') query.type = type;
    if (status && status !== 'all') query.status = status;
    if (userId) query.userId = Number(userId);

    const skip = (Number(page) - 1) * Number(limit);
    const [entitlements, total] = await Promise.all([
      IdentityEntitlement.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('userObjectId', 'name userName userId image')
        .lean(),
      IdentityEntitlement.countDocuments(query),
    ]);

    return sendResponse(res, 200, true, 'Entitlements fetched', {
      entitlements,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to list entitlements');
  }
};

export const revokeEntitlement = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const item = await IdentityEntitlement.findById(id);
    if (!item) return sendResponse(res, 404, false, 'Entitlement not found');

    item.status = 'revoked';
    await item.save();

    await IdentityAuditLog.create({
      action: 'revoke_entitlement',
      targetUserId: item.userId,
      entitlementType: item.type,
      details: { entitlementId: item._id, reason: req.body?.reason || 'Admin revoked' },
      performedBy: {
        adminId: (req.user as any)?._id || req.user?.id,
        adminName: req.user?.name || (req.user as any)?.userName || 'Admin',
        role: req.user?.role || 'admin',
      },
    });

    if (['animated_name', 'name_color'].includes(item.type)) {
      await publishNameEffectUpdate(item.userObjectId);
    }
    return sendResponse(res, 200, true, 'Entitlement revoked successfully');
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to revoke entitlement');
  }
};

export const extendEntitlement = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { days = 30 } = req.body;

    const item = await IdentityEntitlement.findById(id);
    if (!item) return sendResponse(res, 404, false, 'Entitlement not found');

    const baseDate = item.expiresAt > new Date() ? item.expiresAt : new Date();
    item.expiresAt = new Date(baseDate.getTime() + Number(days) * 24 * 60 * 60 * 1000);
    item.status = 'active';
    await item.save();

    await IdentityAuditLog.create({
      action: 'extend_entitlement',
      targetUserId: item.userId,
      entitlementType: item.type,
      details: { addedDays: days, newExpiresAt: item.expiresAt },
      performedBy: {
        adminId: (req.user as any)?._id || req.user?.id,
        adminName: req.user?.name || (req.user as any)?.userName || 'Admin',
        role: req.user?.role || 'admin',
      },
    });

    return sendResponse(res, 200, true, `Entitlement extended by ${days} days`, item);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to extend entitlement');
  }
};

export const getIdentityAuditLogs = async (req: Request, res: Response) => {
  try {
    const { action, userId, page = 1, limit = 50 } = req.query as any;
    const query: any = {};
    if (action && action !== 'all') query.action = action;
    if (userId) query.targetUserId = Number(userId);

    const skip = (Number(page) - 1) * Number(limit);
    const [logs, total] = await Promise.all([
      IdentityAuditLog.find(query).sort({ timestamp: -1 }).skip(skip).limit(Number(limit)).lean(),
      IdentityAuditLog.countDocuments(query),
    ]);

    return sendResponse(res, 200, true, 'Audit logs fetched', {
      logs,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to get audit logs');
  }
};
