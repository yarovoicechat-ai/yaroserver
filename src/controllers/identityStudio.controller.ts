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

// Default pre-seeded animated name styles
const DEFAULT_NAME_EFFECTS = [
  {
    name: 'Imperial Gold Shimmer',
    slug: 'imperial-gold-shimmer',
    category: 'animated_name',
    description: 'Luxurious dynamic gold gradient with animated shimmer and radiant glow',
    config: {
      colors: ['#FFE259', '#FFA751', '#FFD700'],
      gradientDirection: 'horizontal',
      animationType: 'gradient_scroll',
      animationSpeed: 1.2,
      glowColor: '#F59E0B',
      shadowColor: 'rgba(245, 158, 11, 0.4)',
      prefixBadge: '👑',
    },
    previewBg: 'gold',
    eligibleTiers: ['all', 'vip', 'svip'],
    priceDiamonds: 5000,
    isPurchasable: true,
    status: 'active',
    validityDays: 30,
    sortOrder: 1,
  },
  {
    name: 'Cyberpunk Neon Pulse',
    slug: 'cyberpunk-neon-pulse',
    category: 'animated_name',
    description: 'Electric cyan and violet neon pulse with intense glowing aura',
    config: {
      colors: ['#00F2FE', '#4FACFE', '#A855F7'],
      gradientDirection: 'horizontal',
      animationType: 'neon',
      animationSpeed: 1.5,
      glowColor: '#00F2FE',
      shadowColor: 'rgba(0, 242, 254, 0.5)',
      prefixBadge: '⚡',
    },
    previewBg: 'neon',
    eligibleTiers: ['all', 'vip', 'svip'],
    priceDiamonds: 8000,
    isPurchasable: true,
    status: 'active',
    validityDays: 30,
    sortOrder: 2,
  },
  {
    name: 'Velvet Royal Rainbow',
    slug: 'velvet-royal-rainbow',
    category: 'animated_name',
    description: 'Full-spectrum smooth rainbow cycling effect for top gifters and VIPs',
    config: {
      colors: ['#FF0080', '#7928CA', '#0070F3', '#00DFD8'],
      gradientDirection: 'horizontal',
      animationType: 'rainbow',
      animationSpeed: 1.0,
      glowColor: '#EC4899',
      shadowColor: 'rgba(236, 72, 153, 0.4)',
      prefixBadge: '🌈',
    },
    previewBg: 'royal',
    eligibleTiers: ['svip', 'king'],
    priceDiamonds: 15000,
    isPurchasable: true,
    status: 'active',
    validityDays: 30,
    sortOrder: 3,
  },
];

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
    // Seed effects if empty
    const effectCount = await IdentityEffect.countDocuments();
    if (effectCount === 0) {
      await IdentityEffect.insertMany(DEFAULT_NAME_EFFECTS);
    }

    const [nameEffects, svipTiers, vipPackages] = await Promise.all([
      IdentityEffect.find({ status: 'active' }).sort({ sortOrder: 1 }).lean(),
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
   ANIMATED NAMES & NAME COLORS STUDIO
========================================================================= */

export const listNameEffects = async (_req: Request, res: Response) => {
  try {
    const count = await IdentityEffect.countDocuments();
    if (count === 0) {
      await IdentityEffect.insertMany(DEFAULT_NAME_EFFECTS);
    }
    const effects = await IdentityEffect.find().sort({ sortOrder: 1 }).lean();
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
    const effect = await IdentityEffect.findOne({ slug: effectSlug, status: 'active' });
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
    const expiresAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Deactivate previous name effect
    await IdentityEntitlement.updateMany(
      { userId: targetUser.userId, type: 'animated_name', status: 'active' },
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
