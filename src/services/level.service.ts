// level.service.ts - Server-Side Level Progression, EXP Awarding, Claims & Equips
import mongoose, { Types } from 'mongoose';
import { User } from '../models/user.model';
import { LevelExpLog } from '../models/levelLog.model';
import {
  calculateWealthLevel,
  calculateWealthProgress,
  calculateCharmLevel,
  calculateCharmProgress,
  WEALTH_REWARDS,
  CHARM_PACKAGES,
  CHARM_MILESTONES,
  LevelRewardItem,
  WEALTH_THRESHOLDS,
  CHARM_THRESHOLDS,
  generateWealthLevelRanges,
} from './levelEngine';

export class LevelService {
  /**
   * Add Wealth EXP to a user from trusted backend business logic (gift send, diamond spending, VIP, recharge)
   */
  static async addWealthExp(
    userId: string | Types.ObjectId,
    amount: number,
    source: string,
    referenceId?: string
  ) {
    const delta = Math.floor(Number(amount) || 0);
    if (delta <= 0) return null;

    const user = await User.findById(userId).select('wealthExp wealthLevel name');
    if (!user) return null;

    const oldExp = Number(user.wealthExp || 0);
    const oldLevel = Number(user.wealthLevel || 1);
    const newExp = oldExp + delta;
    const newLevel = calculateWealthLevel(newExp);
    const isLevelUp = newLevel > oldLevel;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          wealthExp: newExp,
          wealthLevel: newLevel,
        },
      },
      { new: true }
    ).select('wealthExp wealthLevel name');

    // Audit log
    await LevelExpLog.create({
      userId: new Types.ObjectId(String(userId)),
      type: 'wealth',
      amount: delta,
      source,
      referenceId: referenceId ? String(referenceId) : '',
      oldExp,
      newExp,
      oldLevel,
      newLevel,
    }).catch((err) => console.warn('Failed to log LevelExpLog:', err.message));

    return {
      user: updatedUser,
      oldExp,
      newExp,
      oldLevel,
      newLevel,
      isLevelUp,
      progress: calculateWealthProgress(newExp),
    };
  }

  /**
   * Add Charm EXP to a user from trusted backend business logic (gift received, voice calls received)
   */
  static async addCharmExp(
    userId: string | Types.ObjectId,
    amount: number,
    source: string,
    referenceId?: string
  ) {
    const delta = Math.floor(Number(amount) || 0);
    if (delta <= 0) return null;

    const user = await User.findById(userId).select('charmExp charmLevel name');
    if (!user) return null;

    const oldExp = Number(user.charmExp || 0);
    const oldLevel = Number(user.charmLevel || 1);
    const newExp = oldExp + delta;
    const newLevel = calculateCharmLevel(newExp);
    const isLevelUp = newLevel > oldLevel;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          charmExp: newExp,
          charmLevel: newLevel,
        },
      },
      { new: true }
    ).select('charmExp charmLevel name');

    // Audit log
    await LevelExpLog.create({
      userId: new Types.ObjectId(String(userId)),
      type: 'charm',
      amount: delta,
      source,
      referenceId: referenceId ? String(referenceId) : '',
      oldExp,
      newExp,
      oldLevel,
      newLevel,
    }).catch((err) => console.warn('Failed to log LevelExpLog:', err.message));

    return {
      user: updatedUser,
      oldExp,
      newExp,
      oldLevel,
      newLevel,
      isLevelUp,
      progress: calculateCharmProgress(newExp),
    };
  }

  /**
   * Get user's complete live level status for Wealth and Charm
   */
  static async getUserLevelStatus(userId: string | Types.ObjectId) {
    const user = await User.findById(userId)
      .select(
        'userId name image avatar wealthExp wealthLevel charmExp charmLevel claimedLevelRewards equippedFrame equippedFrameAsset equippedBadge equippedBadges equippedEntrance equippedEntranceAsset equippedVehicle equippedVehicleAsset equippedCustomId equippedProfileBorder equippedProfileBorderAsset equippedRoomTheme equippedMicWave storeInventory'
      )
      .lean();

    if (!user) {
      throw new Error('User not found');
    }

    const wealthExp = Number(user.wealthExp || 0);
    const charmExp = Number(user.charmExp || 0);

    const wealthProgress = calculateWealthProgress(wealthExp);
    const charmProgress = calculateCharmProgress(charmExp);

    // Sync database levels if discrepancies exist
    if (user.wealthLevel !== wealthProgress.level || user.charmLevel !== charmProgress.level) {
      await User.findByIdAndUpdate(userId, {
        $set: {
          wealthLevel: wealthProgress.level,
          charmLevel: charmProgress.level,
        },
      });
      user.wealthLevel = wealthProgress.level;
      user.charmLevel = charmProgress.level;
    }

    const claimedRewards = Array.isArray(user.claimedLevelRewards) ? user.claimedLevelRewards : [];
    const levelRanges = generateWealthLevelRanges(wealthProgress.level);

    return {
      user: {
        _id: user._id,
        userId: user.userId,
        name: user.name,
        avatar: user.image || (user as any).avatar,
      },
      wealth: {
        ...wealthProgress,
        levelRanges,
        claimedRewards: claimedRewards.filter((c) => c.startsWith('w_') || c.startsWith('wealth:')),
      },
      charm: {
        ...charmProgress,
        milestones: CHARM_MILESTONES,
        claimedRewards: claimedRewards.filter((c) => c.startsWith('c_') || c.startsWith('charm:')),
      },
      equipped: {
        frame: user.equippedFrame,
        badge: user.equippedBadge,
        entrance: user.equippedEntrance,
        vehicle: user.equippedVehicle,
        customId: user.equippedCustomId,
        profileBorder: user.equippedProfileBorder,
        theme: user.equippedRoomTheme,
        micWave: user.equippedMicWave,
      },
      claimedRewards,
    };
  }

  /**
   * Claim an unlocked level reward
   */
  static async claimLevelReward(
    userId: string | Types.ObjectId,
    rewardId: string,
    journeyType: 'wealth' | 'charm'
  ) {
    if (!rewardId) {
      throw new Error('Reward ID is required');
    }

    const user = await User.findById(userId).select(
      'wealthExp wealthLevel charmExp charmLevel claimedLevelRewards storeInventory'
    );
    if (!user) {
      throw new Error('User not found');
    }

    let rewardItem: LevelRewardItem | undefined;
    let currentLevel = 1;

    if (journeyType === 'wealth') {
      currentLevel = calculateWealthLevel(Number(user.wealthExp || 0));
      rewardItem = WEALTH_REWARDS.find((r) => r.id === rewardId);
    } else {
      currentLevel = calculateCharmLevel(Number(user.charmExp || 0));
      for (const m of CHARM_MILESTONES) {
        const found = (CHARM_PACKAGES[m] || []).find((r) => r.id === rewardId);
        if (found) {
          rewardItem = found;
          break;
        }
      }
    }

    if (!rewardItem) {
      throw new Error('Invalid reward item');
    }

    if (currentLevel < rewardItem.requiredLevel) {
      throw new Error(
        `Reward requires ${journeyType === 'wealth' ? 'Wealth' : 'Charm'} Level ${rewardItem.requiredLevel}. You are at Level ${currentLevel}.`
      );
    }

    const grantKey = `${journeyType}:${rewardItem.id}`;
    const claims = Array.isArray(user.claimedLevelRewards) ? user.claimedLevelRewards : [];
    if (claims.includes(grantKey) || claims.includes(rewardItem.id)) {
      throw new Error('You have already claimed this reward.');
    }

    const durationDays = Math.max(0, Number(rewardItem.durationDays) || 0);
    const now = new Date();
    const expiresAt = durationDays > 0 ? new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000) : undefined;

    // Map reward type to canonical Store Category
    let category = 'Badge';
    if (rewardItem.type === 'frame') category = 'Frames';
    else if (rewardItem.type === 'entrance' || rewardItem.type === 'vehicle') category = 'Entrance';
    else if (rewardItem.type === 'theme') category = 'Theme';
    else if (rewardItem.type === 'mic') category = 'Mic Wave';
    else if (rewardItem.type === 'profile_border') category = 'Profile Border';
    else if (rewardItem.type === 'custom_id') category = 'Custom ID';
    else if (rewardItem.type === 'party_set' || rewardItem.type === 'room_skin') category = 'Room Skin';

    const inventoryEntry: any = {
      name: rewardItem.name,
      category,
      source: 'level',
      grantKey,
      durationDays,
      purchasedAt: now,
      expiresAt,
      imageUrl: rewardItem.imageUrl || '',
      animationUrl: rewardItem.animationUrl || '',
    };

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $addToSet: { claimedLevelRewards: grantKey },
        $push: { storeInventory: inventoryEntry },
      },
      { new: true }
    ).select('claimedLevelRewards storeInventory');

    return {
      success: true,
      reward: rewardItem,
      grantKey,
      claimedRewards: updatedUser?.claimedLevelRewards || [],
      inventoryItem: inventoryEntry,
    };
  }

  /**
   * Equip / Unequip a claimed level reward
   */
  static async equipLevelReward(
    userId: string | Types.ObjectId,
    rewardId: string,
    journeyType: 'wealth' | 'charm',
    shouldEquip: boolean = true
  ) {
    const user = await User.findById(userId).select(
      'wealthExp charmExp claimedLevelRewards storeInventory'
    );
    if (!user) throw new Error('User not found');

    let rewardItem: LevelRewardItem | undefined;
    if (journeyType === 'wealth') {
      rewardItem = WEALTH_REWARDS.find((r) => r.id === rewardId);
    } else {
      for (const m of CHARM_MILESTONES) {
        const found = (CHARM_PACKAGES[m] || []).find((r) => r.id === rewardId);
        if (found) {
          rewardItem = found;
          break;
        }
      }
    }

    if (!rewardItem) throw new Error('Reward not found');

    const grantKey = `${journeyType}:${rewardItem.id}`;
    const claims = Array.isArray(user.claimedLevelRewards) ? user.claimedLevelRewards : [];
    if (!claims.includes(grantKey) && !claims.includes(rewardItem.id)) {
      throw new Error('You must claim this reward before equipping it');
    }

    const asset = {
      id: rewardItem.id,
      name: rewardItem.name,
      type: rewardItem.type,
      imageUrl: rewardItem.imageUrl || '',
      animationUrl: rewardItem.animationUrl || '',
      previewColor: rewardItem.previewColor || '#F59E0B',
    };

    const update: any = {};
    if (!shouldEquip) {
      if (rewardItem.type === 'badge') update.equippedBadge = null;
      else if (rewardItem.type === 'frame') {
        update.equippedFrame = null;
        update.equippedFrameAsset = null;
      } else if (rewardItem.type === 'entrance') {
        update.equippedEntrance = null;
        update.equippedEntranceAsset = null;
      } else if (rewardItem.type === 'vehicle') {
        update.equippedVehicle = null;
        update.equippedVehicleAsset = null;
      } else if (rewardItem.type === 'custom_id') update.equippedCustomId = null;
      else if (rewardItem.type === 'profile_border') {
        update.equippedProfileBorder = null;
        update.equippedProfileBorderAsset = null;
      } else if (rewardItem.type === 'theme') update.equippedRoomTheme = null;
      else if (rewardItem.type === 'mic') update.equippedMicWave = null;
    } else {
      if (rewardItem.type === 'badge') {
        update.equippedBadge = rewardItem.name;
        update.equippedBadges = [rewardItem.name];
      } else if (rewardItem.type === 'frame') {
        update.equippedFrame = rewardItem.name;
        update.equippedFrameAsset = asset;
      } else if (rewardItem.type === 'entrance') {
        update.equippedEntrance = rewardItem.name;
        update.equippedEntranceAsset = asset;
      } else if (rewardItem.type === 'vehicle') {
        update.equippedVehicle = rewardItem.name;
        update.equippedVehicleAsset = asset;
      } else if (rewardItem.type === 'custom_id') {
        update.equippedCustomId = rewardItem.name;
      } else if (rewardItem.type === 'profile_border') {
        update.equippedProfileBorder = rewardItem.name;
        update.equippedProfileBorderAsset = asset;
      } else if (rewardItem.type === 'theme') {
        update.equippedRoomTheme = rewardItem.id;
      } else if (rewardItem.type === 'mic') {
        update.equippedMicWave = rewardItem.name;
      }
    }

    const updated = await User.findByIdAndUpdate(userId, { $set: update }, { new: true })
      .select(
        'equippedFrame equippedFrameAsset equippedBadge equippedBadges equippedEntrance equippedEntranceAsset equippedVehicle equippedVehicleAsset equippedCustomId equippedProfileBorder equippedProfileBorderAsset equippedRoomTheme equippedMicWave'
      );

    return {
      success: true,
      shouldEquip,
      reward: rewardItem,
      user: updated,
    };
  }

  /**
   * Controlled Admin EXP adjustment with logging & role safety
   */
  static async adjustUserExpByAdmin(
    adminId: string | Types.ObjectId,
    targetUserId: string | Types.ObjectId,
    type: 'wealth' | 'charm',
    deltaAmount: number,
    reason: string = 'Admin manual adjustment'
  ) {
    const delta = Math.floor(Number(deltaAmount) || 0);
    if (delta === 0) throw new Error('Delta amount cannot be 0');

    const user = await User.findById(targetUserId).select(
      'wealthExp wealthLevel charmExp charmLevel name'
    );
    if (!user) throw new Error('Target user not found');

    const isWealth = type === 'wealth';
    const oldExp = isWealth ? Number(user.wealthExp || 0) : Number(user.charmExp || 0);
    const oldLevel = isWealth ? Number(user.wealthLevel || 1) : Number(user.charmLevel || 1);

    const newExp = Math.max(0, oldExp + delta);
    const newLevel = isWealth ? calculateWealthLevel(newExp) : calculateCharmLevel(newExp);

    const update: any = {};
    if (isWealth) {
      update.wealthExp = newExp;
      update.wealthLevel = newLevel;
    } else {
      update.charmExp = newExp;
      update.charmLevel = newLevel;
    }

    const updatedUser = await User.findByIdAndUpdate(targetUserId, { $set: update }, { new: true }).select(
      'wealthExp wealthLevel charmExp charmLevel name'
    );

    // Record audit log
    await LevelExpLog.create({
      userId: new Types.ObjectId(String(targetUserId)),
      type,
      amount: delta,
      source: 'admin_manual_adjustment',
      referenceId: String(adminId),
      oldExp,
      newExp,
      oldLevel,
      newLevel,
      adminId: new Types.ObjectId(String(adminId)),
      reason,
    });

    return {
      user: updatedUser,
      type,
      delta,
      oldExp,
      newExp,
      oldLevel,
      newLevel,
      reason,
    };
  }
}
