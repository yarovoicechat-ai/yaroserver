import { Request, Response } from 'express';
import Family from '../models/family.model';
import sendResponse from '../utils/reponse';
import { User } from '../models/user.model';
import mongoose from 'mongoose';

// Seed default families if collection is empty
const seedDefaultFamilies = async () => {
  const count = await Family.countDocuments();
  if (count === 0) {
    const adminUser = await User.findOne({}).select('_id');
    const leaderId = adminUser ? adminUser._id : null;
    if (leaderId) {
      await Family.create([
        {
          name: 'Royal Emperors',
          badgeText: 'ROYAL',
          avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200',
          cover: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800',
          notice: 'Top clan in Yaro. Only elite gifters and high-level callers allowed!',
          slogan: 'Conquer the throne, rule the night!',
          level: 10,
          exp: 2450,
          ranking: 1,
          diamondsEarned: 1500000,
          leader: leaderId,
          coLeaders: [],
          members: [leaderId],
          memberCount: 28,
          maxMembers: 100,
        },
        {
          name: 'Galaxy Warriors',
          badgeText: 'GLXY',
          avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200',
          cover: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800',
          notice: 'Reaching for the stars! Friendly community with daily voice parties.',
          slogan: 'Shine brighter than the cosmos!',
          level: 7,
          exp: 1800,
          ranking: 2,
          diamondsEarned: 890000,
          leader: leaderId,
          coLeaders: [],
          members: [leaderId],
          memberCount: 19,
          maxMembers: 80,
        },
        {
          name: 'Sweet Harmony',
          badgeText: 'HARM',
          avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200',
          cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800',
          notice: 'Music, singing and friendship. Join our cozy rooms every evening!',
          slogan: 'Melodies that bind our souls.',
          level: 5,
          exp: 950,
          ranking: 3,
          diamondsEarned: 420000,
          leader: leaderId,
          coLeaders: [],
          members: [leaderId],
          memberCount: 14,
          maxMembers: 50,
        },
      ]);
    }
  }
};

/**
 * Get all active families with search & ranking
 */
export const getFamilies = async (req: Request, res: Response) => {
  try {
    await seedDefaultFamilies();
    const { search, limit = 50 } = req.query;
    const filter: any = { isActive: true };
    if (search && typeof search === 'string' && search.trim()) {
      filter.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { badgeText: { $regex: search.trim(), $options: 'i' } },
        { slogan: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    const families = await Family.find(filter)
      .populate('leader', 'name userName avatar level userId')
      .sort({ ranking: 1, diamondsEarned: -1, level: -1 })
      .limit(Number(limit))
      .lean();

    return sendResponse(res, 200, true, 'Families retrieved successfully', { families });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch families');
  }
};

/**
 * Get current authenticated user's active family
 */
export const getMyFamily = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');

    const family = await Family.findOne({
      $or: [{ members: userId }, { leader: userId }, { coLeaders: userId }],
      isActive: true,
    })
      .populate('leader', 'name userName avatar level userId gender')
      .populate('coLeaders', 'name userName avatar level userId gender')
      .populate('members', 'name userName avatar level userId gender')
      .populate('joinRequests.user', 'name userName avatar level userId gender')
      .lean();

    if (!family) {
      return sendResponse(res, 200, true, 'No active family joined', { family: null });
    }

    const isLeader = String((family.leader as any)?._id || family.leader) === String(userId);
    const isCoLeader = (family.coLeaders || []).some(
      (cl: any) => String(cl?._id || cl) === String(userId)
    );

    const todayStr = new Date().toISOString().slice(0, 10);
    const isCheckedInToday = (family.checkins || []).some(
      (chk: any) => String(chk?.user) === String(userId) && chk?.date === todayStr
    );

    return sendResponse(res, 200, true, 'My family details retrieved', {
      family,
      isLeader,
      isCoLeader,
      isCheckedInToday,
      nextLevelExp: (family.level || 1) * 500,
    });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch user family');
  }
};

/**
 * Get family details by ID
 */
export const getFamilyById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(res, 400, false, 'Invalid Family ID');
    }

    const family = await Family.findById(id)
      .populate('leader', 'name userName avatar level userId gender')
      .populate('coLeaders', 'name userName avatar level userId gender')
      .populate('members', 'name userName avatar level userId gender')
      .lean();

    if (!family) {
      return sendResponse(res, 404, false, 'Family not found');
    }
    return sendResponse(res, 200, true, 'Family details retrieved', { family });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch family');
  }
};

/**
 * Create a new Family
 */
export const createFamily = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');

    const { name, badgeText, badge, notice, slogan, avatar, cover } = req.body;
    const finalBadge = (badgeText || badge || 'YARO').trim().toUpperCase();
    const finalName = (name || '').trim();

    if (!finalName) {
      return sendResponse(res, 400, false, 'Family name is required');
    }

    // Check if user is already in a family
    const existingMember = await Family.findOne({
      $or: [{ members: userId }, { leader: userId }],
      isActive: true,
    });
    if (existingMember) {
      return sendResponse(res, 400, false, 'You are already in a family. Please leave it before creating a new one.');
    }

    const existingName = await Family.findOne({ name: { $regex: `^${finalName}$`, $options: 'i' } });
    if (existingName) {
      return sendResponse(res, 400, false, 'Family name already taken');
    }

    const totalCount = await Family.countDocuments();

    const family = await Family.create({
      name: finalName,
      badgeText: finalBadge,
      notice: notice || slogan || 'Welcome to our Family! Let us conquer the leaderboards together.',
      slogan: slogan || notice || 'United we rise, together we conquer!',
      avatar: avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200',
      cover: cover || 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800',
      leader: userId,
      members: [userId],
      coLeaders: [],
      memberCount: 1,
      maxMembers: 50,
      level: 1,
      exp: 0,
      ranking: totalCount + 1,
      diamondsEarned: 0,
      isActive: true,
    });

    const populated = await Family.findById(family._id)
      .populate('leader', 'name userName avatar level userId')
      .populate('members', 'name userName avatar level userId')
      .lean();

    return sendResponse(res, 201, true, 'Family created successfully! 👑', { family: populated });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to create family');
  }
};

/**
 * Join an existing family
 */
export const joinFamily = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(res, 400, false, 'Invalid Family ID');
    }

    const family = await Family.findById(id);
    if (!family || !family.isActive) {
      return sendResponse(res, 404, false, 'Family not found or dissolved');
    }

    const alreadyInFamily = await Family.findOne({
      _id: { $ne: family._id },
      $or: [{ members: userId }, { leader: userId }],
      isActive: true,
    });
    if (alreadyInFamily) {
      return sendResponse(res, 400, false, `You are already a member of "${alreadyInFamily.name}". Please leave it first.`);
    }

    const isMember = family.members.some(m => String(m) === String(userId));
    if (isMember) {
      return sendResponse(res, 400, false, 'You are already a member of this family');
    }

    if (family.members.length >= (family.maxMembers || 50)) {
      return sendResponse(res, 400, false, 'This family has reached maximum member capacity');
    }

    family.members.push(userId);
    family.memberCount = family.members.length;
    await family.save();

    const populated = await Family.findById(family._id)
      .populate('leader', 'name userName avatar level userId')
      .populate('members', 'name userName avatar level userId')
      .lean();

    return sendResponse(res, 200, true, `Joined "${family.name}" successfully! 🎉`, { family: populated });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to join family');
  }
};

/**
 * Leave current family
 */
export const leaveFamily = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');

    const family = await Family.findOne({
      $or: [{ members: userId }, { leader: userId }, { coLeaders: userId }],
      isActive: true,
    });

    if (!family) {
      return sendResponse(res, 404, false, 'You are not part of any active family');
    }

    const isLeader = String(family.leader) === String(userId);

    // If leader is the only member, deactivate family
    if (isLeader && family.members.length <= 1) {
      family.isActive = false;
      await family.save();
      return sendResponse(res, 200, true, 'You were the last member. Family has been dissolved.');
    }

    // If leader leaves but other members exist, transfer leadership
    if (isLeader) {
      // Find candidate: first co-leader or next member
      const nextLeaderId = family.coLeaders.length > 0
        ? family.coLeaders[0]
        : family.members.find(m => String(m) !== String(userId));

      if (nextLeaderId) {
        family.leader = nextLeaderId;
        family.coLeaders = family.coLeaders.filter(cl => String(cl) !== String(nextLeaderId));
      }
    }

    // Remove from coLeaders and members
    family.coLeaders = family.coLeaders.filter(cl => String(cl) !== String(userId));
    family.members = family.members.filter(m => String(m) !== String(userId));
    family.memberCount = family.members.length;

    await family.save();
    return sendResponse(res, 200, true, `You have left ${family.name}.`);
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to leave family');
  }
};

/**
 * Member management: kick, promote to co-leader, demote
 */
export const manageMember = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { id, memberId } = req.params;
    const { action } = req.body; // 'kick' | 'promote_co_leader' | 'demote_co_leader' | 'transfer_leader'

    const family = await Family.findById(id);
    if (!family || !family.isActive) {
      return sendResponse(res, 404, false, 'Family not found');
    }

    const isLeader = String(family.leader) === String(userId);
    const isCoLeader = family.coLeaders.some(cl => String(cl) === String(userId));

    if (!isLeader && !isCoLeader) {
      return sendResponse(res, 403, false, 'Only the Leader or Co-Leaders can manage members');
    }

    if (String(memberId) === String(family.leader)) {
      return sendResponse(res, 400, false, 'Cannot perform this action on the family leader');
    }

    if (action === 'kick') {
      if (!isLeader && family.coLeaders.some(cl => String(cl) === String(memberId))) {
        return sendResponse(res, 403, false, 'Co-Leaders can only be kicked by the Leader');
      }
      family.members = family.members.filter(m => String(m) !== String(memberId));
      family.coLeaders = family.coLeaders.filter(cl => String(cl) !== String(memberId));
      family.memberCount = family.members.length;
      await family.save();
      return sendResponse(res, 200, true, 'Member kicked from family');
    }

    if (!isLeader) {
      return sendResponse(res, 403, false, 'Only the Family Leader can promote or transfer leadership');
    }

    if (action === 'promote_co_leader') {
      if (!family.coLeaders.some(cl => String(cl) === String(memberId))) {
        family.coLeaders.push(new mongoose.Types.ObjectId(memberId));
        await family.save();
      }
      return sendResponse(res, 200, true, 'Member promoted to Co-Leader! ⭐');
    }

    if (action === 'demote_co_leader') {
      family.coLeaders = family.coLeaders.filter(cl => String(cl) !== String(memberId));
      await family.save();
      return sendResponse(res, 200, true, 'Co-Leader demoted to regular member');
    }

    if (action === 'transfer_leader') {
      family.coLeaders = family.coLeaders.filter(cl => String(cl) !== String(memberId));
      family.leader = new mongoose.Types.ObjectId(memberId);
      await family.save();
      return sendResponse(res, 200, true, 'Family leadership transferred successfully 👑');
    }

    return sendResponse(res, 400, false, 'Invalid management action');
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to manage member');
  }
};

/**
 * Daily Family Check-in
 */
export const familyCheckin = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');

    const family = await Family.findOne({
      $or: [{ members: userId }, { leader: userId }, { coLeaders: userId }],
      isActive: true,
    });

    if (!family) {
      return sendResponse(res, 404, false, 'You are not part of any family');
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const alreadyCheckedIn = (family.checkins || []).some(
      (chk: any) => String(chk?.user) === String(userId) && chk?.date === todayStr
    );

    if (alreadyCheckedIn) {
      return sendResponse(res, 400, false, 'Already completed family check-in today! Come back tomorrow.');
    }

    // Award +50 EXP and +10 clan diamonds
    const expGain = 50;
    const diamondsGain = 10;

    family.checkins.push({
      user: userId,
      date: todayStr,
    });

    family.exp = (family.exp || 0) + expGain;
    family.diamondsEarned = (family.diamondsEarned || 0) + diamondsGain;

    // Check level up: 500 EXP per level
    const requiredExp = family.level * 500;
    let leveledUp = false;
    if (family.exp >= requiredExp) {
      family.level += 1;
      family.exp -= requiredExp;
      leveledUp = true;
    }

    await family.save();

    return sendResponse(res, 200, true, leveledUp ? `Check-in complete! Clan leveled up to Lv.${family.level}! 🌟` : 'Clan roll call complete! +50 EXP & +10 Diamonds earned ✨', {
      familyLevel: family.level,
      familyExp: family.exp,
      diamondsEarned: family.diamondsEarned,
      leveledUp,
    });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Check-in failed');
  }
};

/**
 * Update family announcement / slogan
 */
export const updateFamilyNotice = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { id } = req.params;
    const { notice, slogan } = req.body;

    const family = await Family.findById(id);
    if (!family || !family.isActive) {
      return sendResponse(res, 404, false, 'Family not found');
    }

    const isLeader = String(family.leader) === String(userId);
    const isCoLeader = family.coLeaders.some(cl => String(cl) === String(userId));
    if (!isLeader && !isCoLeader) {
      return sendResponse(res, 403, false, 'Only Leader or Co-Leaders can update family notices');
    }

    if (notice !== undefined) family.notice = String(notice).trim();
    if (slogan !== undefined) family.slogan = String(slogan).trim();

    await family.save();
    return sendResponse(res, 200, true, 'Family announcement updated successfully! 📢', { family });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to update notice');
  }
};

// Admin Controller Functions
export const adminGetFamilies = async (req: Request, res: Response) => {
  try {
    await seedDefaultFamilies();
    const families = await Family.find()
      .populate('leader', 'name userName email phone avatar')
      .sort({ createdAt: -1 })
      .lean();
    return sendResponse(res, 200, true, 'Admin families retrieved', { families });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch families for admin');
  }
};

export const adminUpdateFamily = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const update = { ...req.body };
    const updated = await Family.findByIdAndUpdate(id, update, { new: true });
    if (!updated) return sendResponse(res, 404, false, 'Family not found');
    return sendResponse(res, 200, true, 'Family updated successfully', updated);
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to update family');
  }
};

export const adminDeleteFamily = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await Family.findByIdAndDelete(id);
    if (!deleted) return sendResponse(res, 404, false, 'Family not found');
    return sendResponse(res, 200, true, 'Family dissolved and deleted successfully', { id });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to delete family');
  }
};
