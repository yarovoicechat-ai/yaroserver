import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middlewares/authorize.middleware';
import { AssetQuota } from '../models/assetQuota.model';
import { StoreItem } from '../models/storeItem.model';
import { User } from '../models/user.model';
import { AuditLog } from '../models/auditLog.model';
import sendResponse from '../utils/reponse';
import { Logger } from '../utils/logger';
import { createNotification } from '../utils/notificationHelper';

/**
 * POST /api/admin/asset-quota/allocate
 * Owner endpoint to allocate asset inventory quota to Operators with tiered duration buckets
 * Example: 5x Super Admin Frame (1x 30-day, 2x 15-day, 2x 7-day)
 */
export const allocateAssetQuota = async (req: AuthRequest, res: Response) => {
  try {
    const isOwner = req.user?.role === 'owner';
    if (!isOwner) {
      return sendResponse(res, 403, false, 'Access Denied: Only Platform Owner can allocate asset quotas to Operators');
    }

    const {
      operatorId,
      assetQuery,
      packages,
      notes = '',
    } = req.body;

    if (!operatorId) {
      return sendResponse(res, 400, false, 'Operator identifier is required');
    }
    if (!assetQuery) {
      return sendResponse(res, 400, false, 'Asset identifier is required');
    }
    if (!Array.isArray(packages) || packages.length === 0) {
      return sendResponse(res, 400, false, 'At least one duration package (e.g. [{ days: 30, quantity: 1 }]) is required');
    }

    // 1. Resolve Operator
    const operatorSearch: any[] = [];
    if (mongoose.Types.ObjectId.isValid(String(operatorId))) {
      operatorSearch.push({ _id: operatorId });
    }
    if (!isNaN(Number(operatorId))) {
      operatorSearch.push({ userId: Number(operatorId) });
    }
    operatorSearch.push({ email: String(operatorId).trim().toLowerCase() }, { phoneNumber: String(operatorId).trim() });

    const operator = await User.findOne({
      $or: operatorSearch,
      role: { $in: ['operator', 'superAdmin', 'super-admin', 'admin'] }
    });

    if (!operator) {
      return sendResponse(res, 404, false, `Operator with identifier "${operatorId}" not found or does not have operator/admin role`);
    }

    // 2. Resolve Asset
    const assetConditions: any[] = [
      { uniqueId: String(assetQuery).trim() },
      { name: new RegExp(`^${String(assetQuery).trim()}$`, 'i') },
    ];
    if (mongoose.Types.ObjectId.isValid(String(assetQuery))) {
      assetConditions.push({ _id: assetQuery });
    }

    const asset = await StoreItem.findOne({ $or: assetConditions });
    if (!asset) {
      return sendResponse(res, 404, false, `Asset "${assetQuery}" not found in Store Catalog`);
    }

    // 3. Find or Create Quota
    let quota = await AssetQuota.findOne({
      operatorId: operator._id,
      assetName: asset.name,
    });

    if (!quota) {
      quota = new AssetQuota({
        operatorId: operator._id,
        operatorName: operator.name || 'Operator',
        assetId: asset._id,
        uniqueId: asset.uniqueId || '',
        assetName: asset.name,
        assetCategory: asset.category,
        imageUrl: asset.imageUrl || asset.icon || '',
        animationUrl: asset.animationUrl || '',
        packages: [],
        allocatedBy: new mongoose.Types.ObjectId(req.user.id),
        allocatedByRole: 'owner',
        notes,
      });
    } else {
      quota.imageUrl = asset.imageUrl || asset.icon || quota.imageUrl;
      quota.animationUrl = asset.animationUrl || quota.animationUrl;
      quota.notes = notes || quota.notes;
    }

    // 4. Update / Append Packages
    for (const pkg of packages) {
      const days = Number(pkg.days);
      const quantity = Math.max(1, parseInt(String(pkg.quantity), 10) || 1);

      const existingPkg = quota.packages.find((p) => p.days === days);
      if (existingPkg) {
        existingPkg.allocatedQuantity += quantity;
        existingPkg.remainingQuantity += quantity;
      } else {
        quota.packages.push({
          days,
          allocatedQuantity: quantity,
          remainingQuantity: quantity,
        });
      }
    }

    await quota.save();

    // 5. Audit Log
    const totalAllocated = packages.reduce((sum: number, p: any) => sum + (Number(p.quantity) || 0), 0);
    await AuditLog.create({
      adminId: req.user.id,
      action: 'ALLOCATE_ASSET_QUOTA',
      target: String(operator._id),
      details: `Owner allocated ${totalAllocated}x "${asset.name}" to Operator "${operator.name}" with duration tiers: ${packages.map((p: any) => `${p.quantity}x ${p.days}d`).join(', ')}`,
      newValue: {
        operatorId: operator._id,
        operatorName: operator.name,
        assetName: asset.name,
        packages,
      },
      ipAddress: req.ip || '127.0.0.1',
    }).catch(() => null);

    // 6. Notify Operator
    await createNotification(
      String(operator._id),
      `🎁 New Asset Stock Allocated: ${asset.name}`,
      `Platform Owner has allocated ${totalAllocated}x "${asset.name}" to your inventory (${packages.map((p: any) => `${p.quantity}x for ${p.days} days`).join(', ')}). You can now grant these to users from your Operator Panel.`,
      'system',
      {
        action: 'AssetQuota',
        assetName: asset.name,
        packages,
      }
    ).catch(() => null);

    return sendResponse(res, 200, true, `Successfully allocated ${totalAllocated}x "${asset.name}" to Operator ${operator.name}!`, quota);
  } catch (error: any) {
    await Logger('allocateAssetQuota', error);
    return sendResponse(res, 500, false, error.message || 'Failed to allocate asset quota');
  }
};

/**
 * GET /api/admin/asset-quota
 * Retrieve quotas. Operator sees only their own; Owner sees all.
 */
export const getAssetQuotas = async (req: AuthRequest, res: Response) => {
  try {
    const isOwner = req.user?.role === 'owner';
    const filter: any = {};

    if (!isOwner) {
      filter.operatorId = req.user?.id;
    } else if (req.query.operatorId) {
      if (mongoose.Types.ObjectId.isValid(String(req.query.operatorId))) {
        filter.operatorId = req.query.operatorId;
      }
    }

    if (req.query.category && req.query.category !== 'All') {
      filter.assetCategory = req.query.category;
    }

    const quotas = await AssetQuota.find(filter)
      .populate('operatorId', 'userId name email phoneNumber role')
      .sort({ updatedAt: -1 })
      .lean();

    return sendResponse(res, 200, true, 'Asset quotas retrieved successfully', quotas);
  } catch (error: any) {
    await Logger('getAssetQuotas', error);
    return sendResponse(res, 500, false, error.message || 'Failed to fetch asset quotas');
  }
};

/**
 * GET /api/admin/asset-quota/available
 * Operator endpoint to get only available stock with remainingQuantity > 0
 */
export const getOperatorAvailableStock = async (req: AuthRequest, res: Response) => {
  try {
    const isOwner = req.user?.role === 'owner';
    const filter: any = {};

    if (!isOwner) {
      filter.operatorId = req.user?.id;
      filter['packages.remainingQuantity'] = { $gt: 0 };
    }

    const quotas = await AssetQuota.find(filter).sort({ assetName: 1 }).lean();

    // Filter packages so only those with remainingQuantity > 0 are returned for operators
    const available = quotas.map((q) => ({
      ...q,
      availablePackages: isOwner
        ? q.packages
        : q.packages.filter((p) => p.remainingQuantity > 0),
    })).filter((q) => isOwner || q.availablePackages.length > 0);

    return sendResponse(res, 200, true, 'Available stock retrieved', available);
  } catch (error: any) {
    await Logger('getOperatorAvailableStock', error);
    return sendResponse(res, 500, false, error.message || 'Failed to fetch available stock');
  }
};

/**
 * POST /api/admin/asset-quota/grant
 * Operator grants asset to User from their allocated quota.
 * Owner can also call this to grant directly (bypassing quota checks).
 */
export const grantAssetWithQuota = async (req: AuthRequest, res: Response) => {
  try {
    const currentUser = req.user;
    const isOwner = currentUser?.role === 'owner';
    const isOperator = ['operator', 'superAdmin', 'super-admin'].includes(currentUser?.role || '');

    if (!isOwner && !isOperator) {
      return sendResponse(res, 403, false, 'Access Denied: Only Owner or Operator can grant assets');
    }

    const {
      userQuery,
      assetQuery,
      durationDays,
      message = '',
      autoEquip = true,
    } = req.body;

    if (!userQuery) {
      return sendResponse(res, 400, false, 'Target User identifier (User ID / Phone / Email) is required');
    }
    if (!assetQuery) {
      return sendResponse(res, 400, false, 'Asset identifier is required');
    }
    const days = parseInt(String(durationDays), 10);
    if (isNaN(days) || days < 0) {
      return sendResponse(res, 400, false, 'Valid duration in days is required (e.g. 7, 15, 30)');
    }

    // 1. Resolve Target User
    const userConditions: any[] = [];
    if (!isNaN(Number(userQuery))) {
      userConditions.push({ userId: Number(userQuery) });
    }
    userConditions.push(
      { meethiId: String(userQuery).trim() },
      { phoneNumber: String(userQuery).trim() },
      { email: String(userQuery).trim().toLowerCase() }
    );
    if (mongoose.Types.ObjectId.isValid(String(userQuery))) {
      userConditions.push({ _id: userQuery });
    }

    const targetUser: any = await User.findOne({ $or: userConditions });
    if (!targetUser) {
      return sendResponse(res, 404, false, `Target user "${userQuery}" not found`);
    }

    // 2. Resolve Asset in StoreItem
    const assetConditions: any[] = [
      { uniqueId: String(assetQuery).trim() },
      { name: new RegExp(`^${String(assetQuery).trim()}$`, 'i') },
    ];
    if (mongoose.Types.ObjectId.isValid(String(assetQuery))) {
      assetConditions.push({ _id: assetQuery });
    }

    let asset: any = await StoreItem.findOne({ $or: assetConditions });
    if (!asset) {
      return sendResponse(res, 404, false, `Asset "${assetQuery}" not found in catalog`);
    }

    // 3. Quota validation (for Operators)
    let matchedQuota: any = null;
    let matchedPackage: any = null;

    if (!isOwner) {
      // Find operator's quota for this asset
      matchedQuota = await AssetQuota.findOne({
        operatorId: currentUser.id,
        $or: [
          { assetName: asset.name },
          { assetId: asset._id },
          { uniqueId: asset.uniqueId },
        ],
      });

      if (!matchedQuota) {
        return sendResponse(
          res,
          403,
          false,
          `You have not been allocated any stock for "${asset.name}". Please request quota from the Owner.`
        );
      }

      matchedPackage = matchedQuota.packages.find((p: any) => p.days === days);
      if (!matchedPackage || matchedPackage.remainingQuantity <= 0) {
        const availableOptions = matchedQuota.packages
          .filter((p: any) => p.remainingQuantity > 0)
          .map((p: any) => `${p.days} days (${p.remainingQuantity} left)`)
          .join(', ');

        return sendResponse(
          res,
          400,
          false,
          `Out of stock: You have 0 remaining for ${days} days validity. Available options: ${availableOptions || 'None'}`
        );
      }

      // Decrement quota package
      matchedPackage.remainingQuantity -= 1;
      await matchedQuota.save();
    }

    // 4. Credit Target User's Inventory
    const purchasedAt = new Date();
    const expiresAt = days > 0 ? new Date(purchasedAt.getTime() + days * 86400000) : null;

    targetUser.storeInventory = Array.isArray(targetUser.storeInventory) ? targetUser.storeInventory : [];

    const inventoryEntry: any = {
      itemId: asset._id,
      name: asset.name,
      category: asset.category,
      durationDays: days,
      purchasedAt,
      expiresAt,
      imageUrl: asset.imageUrl || asset.icon || '',
      animationUrl: asset.animationUrl || '',
      metadata: asset.metadata || {},
      source: 'admin_grant',
      grantKey: `quota-grant:${Date.now()}:${currentUser?.id || 'operator'}`,
      uniqueId: asset.uniqueId || '',
      message: message || '',
      grantedBy: new mongoose.Types.ObjectId(currentUser.id),
    };

    targetUser.storeInventory.push(inventoryEntry);

    // 5. Auto-equip if requested
    if (autoEquip) {
      const cat = asset.category;
      if (cat === 'Frames' || cat === 'Frame') {
        targetUser.equippedFrame = asset.name;
        targetUser.equippedFrameAsset = {
          name: asset.name,
          imageUrl: asset.imageUrl || asset.icon || '',
          animationUrl: asset.animationUrl || '',
          expiresAt,
        };
      } else if (cat === 'Entry' || cat === 'Entry Effect' || cat === 'Entrance') {
        targetUser.equippedEntry = asset.name;
        targetUser.equippedEntryAsset = {
          name: asset.name,
          imageUrl: asset.imageUrl || asset.icon || '',
          animationUrl: asset.animationUrl || '',
          expiresAt,
        };
      } else if (cat === 'Badge') {
        targetUser.equippedBadge = asset.name;
        targetUser.equippedBadgeAsset = {
          name: asset.name,
          imageUrl: asset.imageUrl || asset.icon || '',
          animationUrl: asset.animationUrl || '',
          expiresAt,
        };
        targetUser.equippedBadges = [targetUser.equippedBadgeAsset];
      } else if (cat === 'Tag') {
        targetUser.equippedTag = asset.name;
        targetUser.equippedTagAsset = {
          name: asset.name,
          imageUrl: asset.imageUrl || asset.icon || '',
          animationUrl: asset.animationUrl || '',
          expiresAt,
        };
        targetUser.equippedEntryTag = asset.metadata?.tagText || asset.badgeText || asset.name;
      } else if (cat === 'Chat Bubble' || cat === 'Chat Bubbles') {
        targetUser.equippedChatBubble = asset.name;
        targetUser.equippedChatBubbleAsset = {
          name: asset.name,
          textColor: asset.metadata?.textColor || '#FEF3C7',
          borderColor: asset.metadata?.borderColor || asset.previewColor || '#F59E0B',
          bgColors: asset.bgColors || ['#78350F', '#B45309', '#D97706'],
          previewColor: asset.previewColor || '#F59E0B',
          imageUrl: asset.imageUrl || asset.icon || '',
          expiresAt,
        };
      }
    }

    await targetUser.save();

    // 6. Notify Recipient User
    const validityText = days > 0 ? `${days} Days` : 'Permanent Lifetime';
    const notifMessage = message?.trim()
      ? message.trim()
      : `🎁 You have received ${asset.name} (${validityText}) granted by ${isOwner ? 'Platform Owner' : 'Operator'}. Check My Items!`;

    await createNotification(
      String(targetUser._id),
      `🎁 New ${asset.category} Granted: ${asset.name}`,
      notifMessage,
      'system',
      {
        action: 'MyItems',
        category: asset.category,
        assetName: asset.name,
        durationDays: days,
        expiresAt,
      }
    ).catch(() => null);

    // 7. Audit Log
    await AuditLog.create({
      adminId: currentUser.id,
      action: 'GRANT_ASSET_FROM_QUOTA',
      target: String(targetUser._id),
      details: `${currentUser.role.toUpperCase()} "${currentUser.name || currentUser.id}" granted "${asset.name}" (${days} days) to user "${targetUser.name}" (${targetUser.userId}). Remaining stock: ${matchedPackage ? matchedPackage.remainingQuantity : 'N/A (Owner)'}`,
      newValue: {
        granterId: currentUser.id,
        granterRole: currentUser.role,
        targetUserId: targetUser._id,
        targetUserNumericId: targetUser.userId,
        targetUserName: targetUser.name,
        assetName: asset.name,
        category: asset.category,
        durationDays: days,
        expiresAt,
        remainingQuantity: matchedPackage ? matchedPackage.remainingQuantity : null,
      },
      ipAddress: req.ip || '127.0.0.1',
    }).catch(() => null);

    return sendResponse(res, 200, true, `Successfully granted "${asset.name}" (${days} days) to ${targetUser.name}!`, {
      user: {
        _id: targetUser._id,
        userId: targetUser.userId,
        name: targetUser.name,
      },
      assetName: asset.name,
      durationDays: days,
      expiresAt,
      remainingStock: matchedPackage ? matchedPackage.remainingQuantity : 'Unlimited (Owner)',
    });
  } catch (error: any) {
    await Logger('grantAssetWithQuota', error);
    return sendResponse(res, 500, false, error.message || 'Failed to grant asset');
  }
};

/**
 * DELETE /api/admin/asset-quota/:id
 * Owner endpoint to delete or adjust an existing quota
 */
export const deleteAssetQuota = async (req: AuthRequest, res: Response) => {
  try {
    const isOwner = req.user?.role === 'owner';
    if (!isOwner) {
      return sendResponse(res, 403, false, 'Access Denied: Only Platform Owner can remove quotas');
    }

    const { id } = req.params;
    await AssetQuota.findByIdAndDelete(id);

    return sendResponse(res, 200, true, 'Asset quota removed successfully');
  } catch (error: any) {
    await Logger('deleteAssetQuota', error);
    return sendResponse(res, 500, false, error.message || 'Failed to remove quota');
  }
};
