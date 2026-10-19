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
import { WealthLevel } from '../models/wealthLevel.model';

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

// Wealth Levels Management (Dynamic Configuration & Expirations)
export const getWealthLevels = async (_req: Request, res: Response) => {
  try {
    let levels = await WealthLevel.find({ isActive: true }).sort({ level: 1 }).lean();
    if (!levels || levels.length === 0) {
      // Auto-populate initial 30 levels from WEALTH_THRESHOLDS
      const defaultDocs = WEALTH_THRESHOLDS.slice(0, 30).map((wt) => {
        const lvl = wt.level;
        return {
          level: lvl,
          name: wt.title || `Wealth Level ${lvl}`,
          diamondsRequired: wt.requiredExp,
          levelTag: lvl >= 10 ? `👑 VIP ${lvl}` : `Level ${lvl}`,
          levelBadge: wt.badgeIcon || '💎',
          badgeColor: lvl >= 15 ? '#F59E0B' : lvl >= 10 ? '#06B6D4' : '#CD7F32',
          perks: [`Wealth Lv.${lvl} Badge`, `Chat Glow`],
          frameReward: {
            enabled: lvl % 5 === 0,
            name: `Wealth Crown Frame Lv.${lvl}`,
            url: '',
            days: 30,
            itemSource: 'upload',
          },
          entryReward: {
            enabled: lvl >= 10,
            name: `Royal Entry Effect Lv.${lvl}`,
            url: '',
            days: 30,
            itemSource: 'upload',
          },
          badgeReward: {
            enabled: true,
            name: `Wealth Lv.${lvl} Badge`,
            url: '',
            days: 0,
            itemSource: 'upload',
          },
          tagReward: {
            enabled: lvl >= 5,
            name: `Wealth Lv.${lvl} Tag`,
            days: 30,
            itemSource: 'upload',
          },
          uniqueIdReward: {
            enabled: lvl >= 20,
            name: `VIP Vanity ID Lv.${lvl}`,
            uniqueDisplayId: '',
            days: 30,
            itemSource: 'upload',
          },
          tasselReward: {
            enabled: lvl >= 15,
            name: `Golden Tassel Lv.${lvl}`,
            url: '',
            days: 30,
            itemSource: 'upload',
          },
          profileBorderReward: {
            enabled: lvl >= 10,
            name: `Profile Glow Border Lv.${lvl}`,
            url: '',
            days: 30,
            itemSource: 'upload',
          },
          customThemeReward: {
            enabled: lvl >= 25,
            name: `Monarch Room Theme Lv.${lvl}`,
            url: '',
            days: 30,
            itemSource: 'upload',
          },
          coverBannerReward: {
            enabled: lvl >= 15,
            name: `Profile Card Cover Banner Lv.${lvl}`,
            url: '',
            days: 30,
            itemSource: 'upload',
          },
          isActive: true,
        };
      });

      await WealthLevel.insertMany(defaultDocs).catch(() => {});
      levels = await WealthLevel.find({ isActive: true }).sort({ level: 1 }).lean();
    }

    return sendResponse(res, 200, true, 'Wealth levels retrieved successfully', levels);
  } catch (error: any) {
    console.error('getWealthLevels error:', error);
    return sendResponse(res, 500, false, error.message || 'Failed to fetch wealth levels');
  }
};

export const saveWealthLevel = async (req: Request, res: Response) => {
  try {
    const {
      level,
      name,
      diamondsRequired,
      levelTag,
      levelBadge,
      badgeColor,
      perks,
      frameReward,
      entryReward,
      badgeReward,
      tagReward,
      uniqueIdReward,
      tasselReward,
      profileBorderReward,
      customThemeReward,
      coverBannerReward,
      isActive = true,
    } = req.body;

    const lvlNum = Number(level);
    if (!lvlNum || lvlNum < 1) {
      return sendResponse(res, 400, false, 'Valid Level number is required');
    }
    if (!name) {
      return sendResponse(res, 400, false, 'Level name is required');
    }

    const payload: any = {
      level: lvlNum,
      name: String(name).trim(),
      diamondsRequired: Math.max(0, Number(diamondsRequired) || 0),
      levelTag: String(levelTag || '').trim(),
      levelBadge: String(levelBadge || '').trim(),
      badgeColor: badgeColor || '#F59E0B',
      perks: Array.isArray(perks) ? perks : [],
      frameReward: frameReward || { enabled: false, days: 30, itemSource: 'upload' },
      entryReward: entryReward || { enabled: false, days: 30, itemSource: 'upload' },
      badgeReward: badgeReward || { enabled: false, days: 30, itemSource: 'upload' },
      tagReward: tagReward || { enabled: false, days: 30, itemSource: 'upload' },
      uniqueIdReward: uniqueIdReward || { enabled: false, days: 30, itemSource: 'upload' },
      tasselReward: tasselReward || { enabled: false, days: 30, itemSource: 'upload' },
      profileBorderReward: profileBorderReward || { enabled: false, days: 30, itemSource: 'upload' },
      customThemeReward: customThemeReward || { enabled: false, days: 30, itemSource: 'upload' },
      coverBannerReward: coverBannerReward || { enabled: false, days: 30, itemSource: 'upload' },
      isActive: Boolean(isActive),
    };

    const doc = await WealthLevel.findOneAndUpdate(
      { level: lvlNum },
      { $set: payload },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return sendResponse(res, 200, true, `Wealth Level ${lvlNum} saved successfully!`, doc);
  } catch (error: any) {
    console.error('saveWealthLevel error:', error);
    return sendResponse(res, 500, false, error.message || 'Failed to save wealth level');
  }
};

export const deleteWealthLevel = async (req: Request, res: Response) => {
  try {
    const level = Number(req.params.level);
    if (!level) {
      return sendResponse(res, 400, false, 'Invalid level number');
    }

    await WealthLevel.deleteOne({ level });
    return sendResponse(res, 200, true, `Wealth Level ${level} deleted successfully`);
  } catch (error: any) {
    console.error('deleteWealthLevel error:', error);
    return sendResponse(res, 500, false, error.message || 'Failed to delete wealth level');
  }
};

