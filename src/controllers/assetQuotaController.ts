import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middlewares/authorize.middleware';
import { AssetQuota } from '../models/assetQuota.model';
import { StoreItem } from '../models/storeItem.model';
import { User } from '../models/user.model';
import { AuditLog } from '../models/auditLog.model';
import sendResponse from '../utils/reponse';
import { Logger } from '../utils/logger';
import { createNotification } from './notificationController';

export interface SingleAllocationInput {
  assetQuery: string;
  packages: Array<{ days: number; quantity: number }>;
}

export interface SingleGrantInput {
  assetQuery: string;
  durationDays: number;
  autoEquip?: boolean;
}

/**
 * Helper to resolve StoreItem by uniqueId, _id, or name
 */
async function resolveStoreAsset(assetQuery: string): Promise<any> {
  const assetConditions: any[] = [
    { uniqueId: String(assetQuery).trim() },
    { name: new RegExp(`^${String(assetQuery).trim()}$`, 'i') },
  ];
  if (mongoose.Types.ObjectId.isValid(String(assetQuery))) {
    assetConditions.push({ _id: assetQuery });
  }
  return await StoreItem.findOne({ $or: assetConditions });
}

/**
 * POST /api/admin/asset-quota/allocate
 * Owner endpoint to allocate asset inventory quota to Operators with tiered duration buckets.
 * Supports single asset allocation OR multiple assets batch allocation!
 */
export const allocateAssetQuota = async (req: AuthRequest, res: Response) => {
  try {
    const adminUser = req.user;
    if (!adminUser) {
      return sendResponse(res, 401, false, 'Authentication required');
    }

    const isOwner = adminUser.role === 'owner';
    if (!isOwner) {
      return sendResponse(res, 403, false, 'Access Denied: Only Platform Owner can allocate asset quotas to Operators');
    }

    const {
      operatorId,
      assetQuery,
      packages,
      allocations, // Array of { assetQuery, packages }
      notes = '',
    } = req.body;

    if (!operatorId) {
      return sendResponse(res, 400, false, 'Operator identifier is required');
    }

    // Build list of allocations to process
    const itemsToAllocate: SingleAllocationInput[] = [];
    if (Array.isArray(allocations) && allocations.length > 0) {
      for (const item of allocations) {
        if (item.assetQuery && Array.isArray(item.packages) && item.packages.length > 0) {
          itemsToAllocate.push(item);
        }
      }
    } else if (assetQuery && Array.isArray(packages) && packages.length > 0) {
      itemsToAllocate.push({ assetQuery, packages });
    }

    if (itemsToAllocate.length === 0) {
      return sendResponse(res, 400, false, 'At least one asset with duration packages is required');
    }

    // 1. Resolve Operator
    const operatorSearch: any[] = [];
    if (mongoose.Types.ObjectId.isValid(String(operatorId))) {
      operatorSearch.push({ _id: operatorId });
    }
    if (!isNaN(Number(operatorId))) {
      operatorSearch.push({ userId: Number(operatorId) });
    }
    operatorSearch.push(
      { email: String(operatorId).trim().toLowerCase() },
      { phoneNumber: String(operatorId).trim() }
    );

    const operator = await User.findOne({
      $or: operatorSearch,
      role: { $in: ['operator', 'superAdmin', 'super-admin', 'admin'] }
    });

    if (!operator) {
      return sendResponse(res, 404, false, `Operator with identifier "${operatorId}" not found or does not have operator/admin role`);
    }

    const savedQuotas: any[] = [];
    const summaryList: string[] = [];

    // 2. Process each asset allocation
    for (const item of itemsToAllocate) {
      const asset = await resolveStoreAsset(item.assetQuery);
      if (!asset) {
        continue;
      }

      // Find or create quota document
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
          allocatedBy: new mongoose.Types.ObjectId(adminUser.id),
          allocatedByRole: 'owner',
          notes,
        });
      } else {
        quota.imageUrl = asset.imageUrl || asset.icon || quota.imageUrl;
        quota.animationUrl = asset.animationUrl || quota.animationUrl;
        quota.notes = notes || quota.notes;
      }

      for (const pkg of item.packages) {
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
      savedQuotas.push(quota);

      const totalItems = item.packages.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);
      summaryList.push(`${totalItems}x "${asset.name}" (${item.packages.map(p => `${p.quantity}x ${p.days}d`).join(', ')})`);
    }

    if (savedQuotas.length === 0) {
      return sendResponse(res, 404, false, 'None of the specified assets were found in the Store Catalog');
    }

    // 3. Audit Log
    await AuditLog.create({
      adminId: adminUser.id,
      action: 'ALLOCATE_ASSET_QUOTA',
      target: String(operator._id),
      details: `Owner allocated ${savedQuotas.length} asset types to Operator "${operator.name}": ${summaryList.join('; ')}`,
      newValue: {
        operatorId: operator._id,
        operatorName: operator.name,
        allocatedAssetsCount: savedQuotas.length,
        summary: summaryList,
      },
      ipAddress: req.ip || '127.0.0.1',
    }).catch(() => null);

    // 4. Notify Operator
    await createNotification(
      String(operator._id),
      `🎁 New Asset Stocks Allocated (${savedQuotas.length} Types)`,
      `Platform Owner has allocated new asset stock to your inventory: ${summaryList.join(', ')}. You can now grant these to users from your Operator Panel.`,
      'system',
      {
        action: 'AssetQuota',
        summary: summaryList,
      }
    ).catch(() => null);

    return sendResponse(
      res,
      200,
      true,
      `Successfully allocated ${savedQuotas.length} asset types to Operator ${operator.name}!`,
      savedQuotas
    );
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
    const adminUser = req.user;
    if (!adminUser) {
      return sendResponse(res, 401, false, 'Authentication required');
    }

    const isOwner = adminUser.role === 'owner';
    const filter: any = {};

    if (!isOwner) {
      filter.operatorId = adminUser.id;
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
    const adminUser = req.user;
    if (!adminUser) {
      return sendResponse(res, 401, false, 'Authentication required');
    }

    const isOwner = adminUser.role === 'owner';
    const filter: any = {};

    if (!isOwner) {
      filter.operatorId = adminUser.id;
      filter['packages.remainingQuantity'] = { $gt: 0 };
    }

    const quotas = await AssetQuota.find(filter).sort({ assetName: 1 }).lean();

    const available = quotas
      .map((q) => ({
        ...q,
        availablePackages: isOwner
          ? q.packages
          : q.packages.filter((p) => p.remainingQuantity > 0),
      }))
      .filter((q) => isOwner || q.availablePackages.length > 0);

    return sendResponse(res, 200, true, 'Available stock retrieved', available);
  } catch (error: any) {
    await Logger('getOperatorAvailableStock', error);
    return sendResponse(res, 500, false, error.message || 'Failed to fetch available stock');
  }
};

/**
 * POST /api/admin/asset-quota/grant
 * Operator grants asset to User from allocated quota (decrements stock).
 * Owner can also call this for unlimited grants.
 * Supports SINGLE grant OR MULTI-GIFT grant in a single request!
 */
export const grantAssetWithQuota = async (req: AuthRequest, res: Response) => {
  try {
    const currentUser = req.user;
    if (!currentUser) {
      return sendResponse(res, 401, false, 'Authentication required');
    }

    const isOwner = currentUser.role === 'owner';
    const isOperator = ['operator', 'superAdmin', 'super-admin'].includes(currentUser.role || '');

    if (!isOwner && !isOperator) {
      return sendResponse(res, 403, false, 'Access Denied: Only Owner or Operator can grant assets');
    }

    const {
      userQuery,
      assetQuery,
      durationDays,
      grants, // Optional array of { assetQuery, durationDays, autoEquip }
      message = '',
      autoEquip = true,
    } = req.body;

    if (!userQuery) {
      return sendResponse(res, 400, false, 'Target User identifier (User ID / Phone / Email) is required');
    }

    // Build grants list to process
    const itemsToGrant: SingleGrantInput[] = [];
    if (Array.isArray(grants) && grants.length > 0) {
      for (const g of grants) {
        if (g.assetQuery && g.durationDays !== undefined) {
          itemsToGrant.push({
            assetQuery: g.assetQuery,
            durationDays: parseInt(String(g.durationDays), 10) || 0,
            autoEquip: g.autoEquip !== undefined ? g.autoEquip : autoEquip,
          });
        }
      }
    } else if (assetQuery && durationDays !== undefined) {
      itemsToGrant.push({
        assetQuery,
        durationDays: parseInt(String(durationDays), 10) || 0,
        autoEquip,
      });
    }

    if (itemsToGrant.length === 0) {
      return sendResponse(res, 400, false, 'At least one asset to grant with valid duration is required');
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

    targetUser.storeInventory = Array.isArray(targetUser.storeInventory) ? targetUser.storeInventory : [];

    const successfulGrants: any[] = [];
    const grantNames: string[] = [];

    // 2. Process each grant
    for (const grantItem of itemsToGrant) {
      const asset = await resolveStoreAsset(grantItem.assetQuery);
      if (!asset) {
        continue;
      }

      const days = grantItem.durationDays;
      let matchedPackage: any = null;

      // Check quota for Operators
      if (!isOwner) {
        const matchedQuota = await AssetQuota.findOne({
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
            `You do not have any allocated stock for "${asset.name}". Please request quota from the Owner.`
          );
        }

        matchedPackage = matchedQuota.packages.find((p: any) => p.days === days);
        if (!matchedPackage || matchedPackage.remainingQuantity <= 0) {
          const availableOptions = matchedQuota.packages
            .filter((p: any) => p.remainingQuantity > 0)
            .map((p: any) => `${p.days}d (${p.remainingQuantity} left)`)
            .join(', ');

          return sendResponse(
            res,
            400,
            false,
            `Out of stock: 0 remaining for "${asset.name}" with ${days} days validity. Available: ${availableOptions || 'None'}`
          );
        }

        matchedPackage.remainingQuantity -= 1;
        await matchedQuota.save();
      }

      // Add to user storeInventory
      const purchasedAt = new Date();
      const expiresAt = days > 0 ? new Date(purchasedAt.getTime() + days * 86400000) : null;

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
        grantKey: `quota-grant:${Date.now()}:${currentUser.id || 'operator'}`,
        uniqueId: asset.uniqueId || '',
        message: message || '',
        grantedBy: new mongoose.Types.ObjectId(currentUser.id),
      };

      targetUser.storeInventory.push(inventoryEntry);

      // Auto-equip
      if (grantItem.autoEquip) {
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

      successfulGrants.push({
        assetName: asset.name,
        category: asset.category,
        durationDays: days,
        expiresAt,
        remainingStock: matchedPackage ? matchedPackage.remainingQuantity : 'Unlimited (Owner)',
      });
      grantNames.push(`${asset.name} (${days > 0 ? `${days}d` : 'Permanent'})`);
    }

    if (successfulGrants.length === 0) {
      return sendResponse(res, 404, false, 'None of the specified assets could be granted');
    }

    await targetUser.save();

    // 3. Notify Recipient User
    const notifMessage = message?.trim()
      ? message.trim()
      : `🎁 You have received ${grantNames.join(', ')} granted by ${isOwner ? 'Platform Owner' : 'Operator'}. Check My Items!`;

    await createNotification(
      String(targetUser._id),
      `🎁 ${successfulGrants.length} New Rewards Granted!`,
      notifMessage,
      'system',
      {
        action: 'MyItems',
        grantsCount: successfulGrants.length,
        items: grantNames,
      }
    ).catch(() => null);

    // 4. Audit Log
    await AuditLog.create({
      adminId: currentUser.id,
      action: 'GRANT_ASSET_FROM_QUOTA',
      target: String(targetUser._id),
      details: `${currentUser.role.toUpperCase()} "${currentUser.name || currentUser.id}" granted ${successfulGrants.length} items to user "${targetUser.name}" (${targetUser.userId}): ${grantNames.join('; ')}`,
      newValue: {
        granterId: currentUser.id,
        granterRole: currentUser.role,
        targetUserId: targetUser._id,
        targetUserNumericId: targetUser.userId,
        targetUserName: targetUser.name,
        grants: successfulGrants,
      },
      ipAddress: req.ip || '127.0.0.1',
    }).catch(() => null);

    return sendResponse(
      res,
      200,
      true,
      `Successfully granted ${successfulGrants.length} assets to ${targetUser.name}!`,
      {
        user: {
          _id: targetUser._id,
          userId: targetUser.userId,
          name: targetUser.name,
        },
        grants: successfulGrants,
      }
    );
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
    const adminUser = req.user;
    if (!adminUser) {
      return sendResponse(res, 401, false, 'Authentication required');
    }

    const isOwner = adminUser.role === 'owner';
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
