import { Request, Response } from 'express';
import { User } from '../models/user.model';
import { UniqueIdRequest } from '../models/uniqueIdRequest.model';
import { IdentityEntitlement } from '../models/identityEntitlement.model';
import sendResponse from '../utils/reponse';
import AppError from '../utils/errorHandler';

/**
 * Helper to check whether a specific custom ID is already taken by any user.
 */
export const checkIdTaken = async (
  requestedId: string,
  excludeUserId?: string
): Promise<{ isTaken: boolean; existingUser?: { name: string; userId: number; id: string } }> => {
  const cleanId = String(requestedId || '').trim();
  if (!cleanId) return { isTaken: false };

  const numVal = Number(cleanId);
  const orConditions: any[] = [
    { customDisplayId: cleanId },
    { equippedCustomId: cleanId },
    { uniqueId: cleanId },
    { userName: cleanId },
  ];
  if (!isNaN(numVal) && numVal > 0) {
    orConditions.push({ userId: numVal });
  }

  const query: any = { $or: orConditions };
  if (excludeUserId) {
    query._id = { $ne: excludeUserId };
  }

  const existingUser = await User.findOne(query).select('name userId _id').lean();
  if (existingUser) {
    return {
      isTaken: true,
      existingUser: {
        name: existingUser.name || 'User',
        userId: existingUser.userId,
        id: String(existingUser._id),
      },
    };
  }

  // Also check active IdentityEntitlements
  const entitlementQuery: any = {
    type: 'unique_id',
    'config.displayId': cleanId,
    status: 'active',
  };
  if (excludeUserId) {
    entitlementQuery.userObjectId = { $ne: excludeUserId };
  }

  const existingEntitlement = await IdentityEntitlement.findOne(entitlementQuery)
    .select('userId userObjectId')
    .lean();

  if (existingEntitlement) {
    return {
      isTaken: true,
      existingUser: {
        name: 'Assigned Entitlement',
        userId: existingEntitlement.userId,
        id: String(existingEntitlement.userObjectId || ''),
      },
    };
  }

  return { isTaken: false };
};

/**
 * Public/Admin Endpoint: Check if a requested ID is available.
 */
export const checkUniqueIdAvailability = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawId = req.params.requestedId || req.query.id;
    const cleanId = String(rawId || '').trim();

    if (!cleanId) {
      return sendResponse(res, 400, false, 'ID is required to check availability');
    }

    const { isTaken, existingUser } = await checkIdTaken(cleanId);
    if (isTaken && existingUser) {
      return sendResponse(res, 200, true, `ID "${cleanId}" is already taken`, {
        available: false,
        requestedId: cleanId,
        existingUser,
      });
    }

    return sendResponse(res, 200, true, `ID "${cleanId}" is available!`, {
      available: true,
      requestedId: cleanId,
    });
  } catch (error: any) {
    console.error('checkUniqueIdAvailability error:', error);
    return sendResponse(res, 500, false, error.message || 'Error checking ID availability');
  }
};

/**
 * User Endpoint: Submit a request for a custom Unique Number ID upon reaching level.
 */
export const requestUniqueId = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id || (req.user as any)?._id;
    if (!userId) {
      return sendResponse(res, 401, false, 'Unauthorized');
    }

    const { levelType = 'wealth', levelNumber, requestedId, badgeName, badgeIcon } = req.body;
    const cleanId = String(requestedId || '').trim();
    const lvlNum = Number(levelNumber);

    if (!cleanId) {
      return sendResponse(res, 400, false, 'Please enter your desired Unique ID');
    }
    if (!lvlNum || lvlNum < 1) {
      return sendResponse(res, 400, false, 'Valid level number is required');
    }

    // Verify user exists and has reached this level
    const user = await User.findById(userId).select('userId name image avatar wealthLevel charmLevel');
    if (!user) {
      return sendResponse(res, 404, false, 'User not found');
    }

    const currentLevel = levelType === 'charm' ? Number(user.charmLevel || 1) : Number(user.wealthLevel || 1);
    if (currentLevel < lvlNum) {
      return sendResponse(
        res,
        400,
        false,
        `You need to reach ${levelType === 'charm' ? 'Charm' : 'Wealth'} Level ${lvlNum} to claim this Unique ID perk! (Your level: ${currentLevel})`
      );
    }

    // Check if ID is already taken
    const { isTaken, existingUser } = await checkIdTaken(cleanId, String(user._id));
    if (isTaken) {
      return sendResponse(
        res,
        400,
        false,
        `The ID "${cleanId}" is already taken by another user. Please choose a different number.`
      );
    }

    // Check if user already has an active pending request for this level
    const existingPending = await UniqueIdRequest.findOne({
      userId: user._id,
      levelType,
      levelNumber: lvlNum,
      status: 'pending',
    });

    if (existingPending) {
      existingPending.requestedId = cleanId;
      if (badgeName) existingPending.badgeName = badgeName;
      if (badgeIcon) existingPending.badgeIcon = badgeIcon;
      await existingPending.save();
      return sendResponse(res, 200, true, `Unique ID request updated to "${cleanId}"! Awaiting admin review.`, existingPending);
    }

    // Create new request
    const newRequest = await UniqueIdRequest.create({
      userId: user._id,
      originalUserId: user.userId,
      userName: user.name || 'User',
      userAvatar: user.image || (user as any).avatar || '',
      levelType,
      levelNumber: lvlNum,
      requestedId: cleanId,
      badgeName: badgeName || '',
      badgeIcon: badgeIcon || '',
      status: 'pending',
    });

    return sendResponse(
      res,
      201,
      true,
      `Request for Unique ID "${cleanId}" submitted successfully! It will be assigned to your profile once approved by management.`,
      newRequest
    );
  } catch (error: any) {
    console.error('requestUniqueId error:', error);
    return sendResponse(res, 500, false, error.message || 'Error submitting Unique ID request');
  }
};

/**
 * User Endpoint: Get user's own Unique ID requests
 */
export const getMyUniqueIdRequests = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id || (req.user as any)?._id;
    if (!userId) {
      return sendResponse(res, 401, false, 'Unauthorized');
    }

    const requests = await UniqueIdRequest.find({ userId }).sort({ createdAt: -1 }).lean();
    return sendResponse(res, 200, true, 'Requests retrieved', requests);
  } catch (error: any) {
    console.error('getMyUniqueIdRequests error:', error);
    return sendResponse(res, 500, false, error.message || 'Error fetching requests');
  }
};

/**
 * Admin Endpoint: List all Unique ID requests with filtering & pagination
 */
export const listUniqueIdRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status = 'all', search, page = 1, limit = 50 } = req.query;
    const filter: any = {};

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (search) {
      const q = String(search).trim();
      const num = Number(q);
      const orClauses: any[] = [
        { userName: { $regex: q, $options: 'i' } },
        { requestedId: { $regex: q, $options: 'i' } },
      ];
      if (!isNaN(num)) {
        orClauses.push({ originalUserId: num });
      }
      filter.$or = orClauses;
    }

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [requests, total, pendingCount] = await Promise.all([
      UniqueIdRequest.find(filter)
        .sort({ status: 1, createdAt: -1 }) // Pending first
        .skip(skip)
        .limit(limitNum)
        .lean(),
      UniqueIdRequest.countDocuments(filter),
      UniqueIdRequest.countDocuments({ status: 'pending' }),
    ]);

    return sendResponse(res, 200, true, 'Unique ID requests retrieved', {
      requests,
      total,
      pendingCount,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error: any) {
    console.error('listUniqueIdRequests error:', error);
    return sendResponse(res, 500, false, error.message || 'Error listing Unique ID requests');
  }
};

/**
 * Admin Endpoint: Approve a Unique ID request.
 * CRITICAL REQUIREMENT: Strictly verifies that the requested ID does not already exist
 * in the database before granting!
 */
export const approveUniqueIdRequest = async (req: any, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.id || (req.user as any)?._id;
    const { id } = req.params;

    const request = await UniqueIdRequest.findById(id);
    if (!request) {
      return sendResponse(res, 404, false, 'Unique ID request not found');
    }

    if (request.status === 'approved') {
      return sendResponse(res, 400, false, 'This request has already been approved!');
    }

    const cleanId = String(request.requestedId).trim();

    // 🔒 STRICT UNIQUENESS CHECK: Ensure ID is not already owned/equipped by ANY other user
    const { isTaken, existingUser } = await checkIdTaken(cleanId, String(request.userId));
    if (isTaken && existingUser) {
      return sendResponse(
        res,
        409,
        false,
        `Cannot approve: The ID "${cleanId}" is ALREADY TAKEN by user "${existingUser.name}" (Original ID: ${existingUser.userId})! Please reject or ask user for a different number.`
      );
    }

    // 1. Assign ID directly to the user
    await User.findByIdAndUpdate(request.userId, {
      $set: {
        equippedCustomId: cleanId,
        customDisplayId: cleanId,
        uniqueId: cleanId,
      },
      $push: {
        storeInventory: {
          name: cleanId,
          category: 'Unique ID',
          source: 'level',
          uniqueId: cleanId,
          durationDays: 0,
          purchasedAt: new Date(),
          imageUrl: request.badgeIcon || '',
          message: `Approved ${request.levelType} Lv.${request.levelNumber} perk`,
        },
      },
    });

    // 2. Register/activate in IdentityEntitlement for global resolution
    await IdentityEntitlement.findOneAndUpdate(
      {
        userObjectId: request.userId,
        type: 'unique_id',
      },
      {
        $set: {
          userId: request.originalUserId,
          userObjectId: request.userId,
          type: 'unique_id',
          config: {
            displayId: cleanId,
            badgeName: request.badgeName || `${request.levelType.toUpperCase()} Lv.${request.levelNumber} VIP ID`,
            badgeIconUrl: request.badgeIcon || '',
          },
          status: 'active',
          grantSource: `${request.levelType}_level_reward`,
          grantReason: `Approved level ${request.levelNumber} custom Unique ID request`,
          startsAt: new Date(),
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000 * 10), // 10 years
        },
      },
      { upsert: true, new: true }
    );

    // 3. Mark request approved
    request.status = 'approved';
    request.reviewedBy = adminId;
    request.reviewedAt = new Date();
    await request.save();

    return sendResponse(
      res,
      200,
      true,
      `Request approved successfully! ID "${cleanId}" is now permanently assigned to user ${request.userName} (${request.originalUserId}).`,
      request
    );
  } catch (error: any) {
    console.error('approveUniqueIdRequest error:', error);
    return sendResponse(res, 500, false, error.message || 'Error approving request');
  }
};

/**
 * Admin Endpoint: Reject a Unique ID request.
 */
export const rejectUniqueIdRequest = async (req: any, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.id || (req.user as any)?._id;
    const { id } = req.params;
    const { reason = 'Rejected by administrator' } = req.body;

    const request = await UniqueIdRequest.findById(id);
    if (!request) {
      return sendResponse(res, 404, false, 'Unique ID request not found');
    }

    request.status = 'rejected';
    request.rejectionReason = String(reason).trim();
    request.reviewedBy = adminId;
    request.reviewedAt = new Date();
    await request.save();

    return sendResponse(res, 200, true, `Request for ID "${request.requestedId}" has been rejected.`, request);
  } catch (error: any) {
    console.error('rejectUniqueIdRequest error:', error);
    return sendResponse(res, 500, false, error.message || 'Error rejecting request');
  }
};
