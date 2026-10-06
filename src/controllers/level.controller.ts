// level.controller.ts - HTTP Controller for Yaro Level System
import { Request, Response } from 'express';
import { LevelService } from '../services/level.service';
import {
  WEALTH_THRESHOLDS,
  CHARM_THRESHOLDS,
  WEALTH_REWARDS,
  CHARM_PACKAGES,
  CHARM_MILESTONES,
  generateWealthLevelRanges,
} from '../services/levelEngine';
import sendResponse from '../utils/reponse';
import { User } from '../models/user.model';

export const getMyLevelStatus = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || (req.user as any)?._id;
    if (!userId) {
      return sendResponse(res, 401, false, 'Unauthorized');
    }

    const status = await LevelService.getUserLevelStatus(userId);
    return sendResponse(res, 200, true, 'Level status fetched', status);
  } catch (error: any) {
    console.error('getMyLevelStatus error:', error);
    return sendResponse(res, 500, false, error.message || 'Failed to fetch level status');
  }
};

export const getLevelConfig = async (req: Request, res: Response) => {
  try {
    return sendResponse(res, 200, true, 'Level configuration fetched', {
      wealth: {
        thresholds: WEALTH_THRESHOLDS,
        rewards: WEALTH_REWARDS,
        maxLevel: 150,
      },
      charm: {
        thresholds: CHARM_THRESHOLDS,
        milestones: CHARM_MILESTONES,
        packages: CHARM_PACKAGES,
        maxLevel: 150,
      },
    });
  } catch (error: any) {
    console.error('getLevelConfig error:', error);
    return sendResponse(res, 500, false, error.message || 'Failed to fetch level configuration');
  }
};

export const claimReward = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || (req.user as any)?._id;
    if (!userId) {
      return sendResponse(res, 401, false, 'Unauthorized');
    }

    const { rewardId, journeyType = 'wealth' } = req.body;
    if (!rewardId) {
      return sendResponse(res, 400, false, 'Reward ID is required');
    }

    const result = await LevelService.claimLevelReward(userId, rewardId, journeyType);
    return sendResponse(res, 200, true, 'Reward claimed successfully! 🎉', result);
  } catch (error: any) {
    console.error('claimReward error:', error);
    return sendResponse(res, 400, false, error.message || 'Failed to claim reward');
  }
};

export const equipReward = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || (req.user as any)?._id;
    if (!userId) {
      return sendResponse(res, 401, false, 'Unauthorized');
    }

    const { rewardId, journeyType = 'wealth', shouldEquip = true } = req.body;
    if (!rewardId) {
      return sendResponse(res, 400, false, 'Reward ID is required');
    }

    const result = await LevelService.equipLevelReward(userId, rewardId, journeyType, shouldEquip);
    return sendResponse(res, 200, true, shouldEquip ? 'Item equipped successfully' : 'Item unequipped', result);
  } catch (error: any) {
    console.error('equipReward error:', error);
    return sendResponse(res, 400, false, error.message || 'Failed to equip reward');
  }
};

// Admin Endpoints
export const adminAdjustUserExp = async (req: any, res: Response) => {
  try {
    const adminId = req.user?.id;
    const { targetUserId, type, deltaAmount, reason } = req.body;

    if (!targetUserId || !type || deltaAmount === undefined) {
      return sendResponse(res, 400, false, 'Missing targetUserId, type, or deltaAmount');
    }

    if (!['wealth', 'charm'].includes(type)) {
      return sendResponse(res, 400, false, 'Type must be either "wealth" or "charm"');
    }

    const result = await LevelService.adjustUserExpByAdmin(
      adminId,
      targetUserId,
      type,
      Number(deltaAmount),
      reason || 'Admin manual adjustment'
    );

    return sendResponse(res, 200, true, 'User EXP adjusted successfully', result);
  } catch (error: any) {
    console.error('adminAdjustUserExp error:', error);
    return sendResponse(res, 500, false, error.message || 'Failed to adjust user EXP');
  }
};

export const adminSearchUsersLevels = async (req: Request, res: Response) => {
  try {
    const query = String(req.query.q || '').trim();
    const filter: any = {};
    if (query) {
      const num = Number(query);
      if (!isNaN(num)) {
        filter.$or = [{ userId: num }, { name: { $regex: query, $options: 'i' } }];
      } else {
        filter.name = { $regex: query, $options: 'i' };
      }
    }

    const users = await User.find(filter)
      .select('userId name image avatar wealthExp wealthLevel charmExp charmLevel level role')
      .limit(30)
      .lean();

    return sendResponse(res, 200, true, 'Users level list fetched', users);
  } catch (error: any) {
    console.error('adminSearchUsersLevels error:', error);
    return sendResponse(res, 500, false, error.message || 'Failed to search users');
  }
};
