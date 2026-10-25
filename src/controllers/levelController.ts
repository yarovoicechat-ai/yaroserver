import { Request, Response, NextFunction } from 'express';
import ProgressionLevel from '../models/progressionLevel.model';
import HostLevel from '../models/hostLevel.model';
import { WEALTH_THRESHOLDS, CHARM_THRESHOLDS } from '../services/levelEngine';
import sendResponse from '../utils/reponse';
import AppError from '../utils/errorHandler';
import { Logger } from '../utils/logger';

const ALLOWED_REWARD_TYPES = ['frame', 'entry', 'badge', 'tag', 'vehicle', 'micWave', 'theme', 'uniqueId'];

const normalizeRewards = (rewards: any) =>
  (Array.isArray(rewards) ? rewards : [])
    .filter((reward: any) => ALLOWED_REWARD_TYPES.includes(reward?.type) && String(reward?.name || '').trim())
    .map((reward: any) => ({
      type: reward.type,
      name: String(reward.name).trim(),
      imageUrl: String(reward.imageUrl || '').trim(),
      animationUrl: String(reward.animationUrl || '').trim(),
      durationDays: Math.max(0, Number(reward.durationDays) || 0),
      uniqueIdConfig: reward.type === 'uniqueId' ? {
        mode: reward.uniqueIdConfig?.mode === 'select' ? 'select' : 'request',
        uniqueDisplayId: String(reward.uniqueIdConfig?.uniqueDisplayId || '').trim(),
        uniqueIdLevelId: String(reward.uniqueIdConfig?.uniqueIdLevelId || '').trim(),
        badgeName: String(reward.uniqueIdConfig?.badgeName || '').trim(),
        badgeIconUrl: String(reward.uniqueIdConfig?.badgeIconUrl || '').trim(),
      } : undefined,
    }));

/**
 * Seed initial levels from canonical thresholds if none exist yet for this journey type
 */
const seedInitialProgressionLevels = async (type: 'wealth' | 'charm') => {
  const count = await ProgressionLevel.countDocuments({ type });
  if (count > 0) return;

  const thresholds = type === 'wealth' ? WEALTH_THRESHOLDS.slice(0, 30) : CHARM_THRESHOLDS.slice(0, 30);
  const docs = thresholds.map((t) => {
    const rewards: any[] = [
      {
        type: 'badge',
        name: `${type === 'wealth' ? 'Wealth' : 'Charm'} Lv.${t.level} Badge`,
        imageUrl: '',
        durationDays: 0,
      },
    ];

    if (t.level % 5 === 0) {
      rewards.push({
        type: 'frame',
        name: `${t.title} Avatar Frame`,
        imageUrl: '',
        durationDays: 30,
      });
    }

    if (t.level >= 10 && t.level % 10 === 0) {
      rewards.push({
        type: 'entry',
        name: `${t.title} Entrance Effect`,
        imageUrl: '',
        durationDays: 30,
      });
    }

    // Add Unique ID reward on milestone levels (Lv 20, 30, 40, etc.)
    if (t.level >= 20 && t.level % 10 === 0) {
      rewards.push({
        type: 'uniqueId',
        name: `${type === 'wealth' ? 'Wealth' : 'Charm'} Lv.${t.level} Unique ID Privilege`,
        imageUrl: '',
        durationDays: 0,
        uniqueIdConfig: {
          mode: 'request',
          badgeName: `${t.tier} ID`,
          badgeIconUrl: '',
        },
      });
    }

    return {
      type,
      level: t.level,
      name: t.title || `${type === 'wealth' ? 'Wealth' : 'Charm'} Lv.${t.level}`,
      requiredExp: t.requiredExp,
      badgeIcon: '',
      badgeAnimation: '',
      badgeColor: t.color || (type === 'wealth' ? '#F59E0B' : '#EC4899'),
      levelTag: t.tier || `Lv.${t.level}`,
      rewards,
      isActive: true,
    };
  });

  await ProgressionLevel.insertMany(docs).catch((err) =>
    console.warn(`[levelController] Failed to auto-seed ${type} levels:`, err.message)
  );
};

// GET all levels (by type: 'wealth' | 'charm', sorted by level number)
export const getLevels = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const type = (req.query.type as string) === 'charm' ? 'charm' : 'wealth';

    // Auto-seed initial 30 levels if table is empty
    await seedInitialProgressionLevels(type);

    const levels = await ProgressionLevel.find({ type, isActive: true }).sort({ level: 1 }).lean();

    return sendResponse(res, 200, true, `${type.toUpperCase()} levels fetched successfully`, levels);
  } catch (error) {
    await Logger('getLevels', error);
    next(new AppError('Error fetching levels', 500));
  }
};

// CREATE a new level (EXP based with direct uploaded assets)
export const createLevel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      type = 'wealth',
      level,
      name,
      requiredExp,
      minCalls,
      diamondsRequired,
      badgeIcon,
      badgeAnimation,
      badgeColor,
      levelTag,
      rewards,
    } = req.body;

    const journeyType = type === 'charm' ? 'charm' : 'wealth';
    const lvlNum = Number(level);
    if (!lvlNum || lvlNum < 1) {
      return next(new AppError('Valid level number is required', 400));
    }
    if (!name) {
      return next(new AppError('Level name is required', 400));
    }

    const exp = Number(requiredExp ?? diamondsRequired ?? minCalls ?? 0);

    const existing = await ProgressionLevel.findOne({ type: journeyType, level: lvlNum });
    if (existing) {
      return next(new AppError(`${journeyType.toUpperCase()} Level ${lvlNum} already exists`, 409));
    }

    const newLevel = await ProgressionLevel.create({
      type: journeyType,
      level: lvlNum,
      name: String(name).trim(),
      requiredExp: Math.max(0, exp),
      badgeIcon: String(badgeIcon || '').trim(),
      badgeAnimation: String(badgeAnimation || '').trim(),
      badgeColor: badgeColor || (journeyType === 'wealth' ? '#F59E0B' : '#EC4899'),
      levelTag: String(levelTag || '').trim(),
      rewards: normalizeRewards(rewards),
      isActive: true,
    });

    return sendResponse(res, 201, true, `${journeyType.toUpperCase()} Level created successfully`, newLevel);
  } catch (error) {
    await Logger('createLevel', error);
    next(new AppError('Error creating level', 500));
  }
};

// UPDATE a level
export const updateLevel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      type,
      name,
      requiredExp,
      diamondsRequired,
      minCalls,
      badgeIcon,
      badgeAnimation,
      badgeColor,
      levelTag,
      rewards,
      isActive,
    } = req.body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = String(name).trim();
    if (requiredExp !== undefined || diamondsRequired !== undefined || minCalls !== undefined) {
      updateData.requiredExp = Math.max(0, Number(requiredExp ?? diamondsRequired ?? minCalls ?? 0));
    }
    if (badgeIcon !== undefined) updateData.badgeIcon = String(badgeIcon).trim();
    if (badgeAnimation !== undefined) updateData.badgeAnimation = String(badgeAnimation).trim();
    if (badgeColor !== undefined) updateData.badgeColor = badgeColor;
    if (levelTag !== undefined) updateData.levelTag = String(levelTag).trim();
    if (rewards !== undefined) updateData.rewards = normalizeRewards(rewards);
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);

    let updated = await ProgressionLevel.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });

    if (!updated) {
      // Fallback check on HostLevel for legacy records
      updated = await HostLevel.findByIdAndUpdate(id, updateData, { new: true });
    }

    if (!updated) {
      return next(new AppError('Level not found', 404));
    }

    return sendResponse(res, 200, true, 'Level updated successfully', updated);
  } catch (error) {
    await Logger('updateLevel', error);
    next(new AppError('Error updating level', 500));
  }
};

// DELETE a level
export const deleteLevel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    let deleted = await ProgressionLevel.findByIdAndDelete(id);
    if (!deleted) {
      deleted = await HostLevel.findByIdAndDelete(id);
    }

    if (!deleted) {
      return next(new AppError('Level not found', 404));
    }

    return sendResponse(res, 200, true, 'Level deleted successfully', null);
  } catch (error) {
    await Logger('deleteLevel', error);
    next(new AppError('Error deleting level', 500));
  }
};
