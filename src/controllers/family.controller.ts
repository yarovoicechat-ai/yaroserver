import { Request, Response } from 'express';
import Family from '../models/family.model';
import sendResponse from '../utils/reponse';
import { User } from '../models/user.model';
import { Room } from '../models/room.model';
import mongoose from 'mongoose';

// 4 Clan Levels Configuration
export const CLAN_LEVEL_CONFIG: { [level: number]: { name: string; expRequired: number; maxMembers: number; maxCoLeaders: number; perk: string } } = {
  1: {
    name: 'Bronze Clan',
    expRequired: 0,
    maxMembers: 20,
    maxCoLeaders: 0,
    perk: 'Basic Clan Badge & Clan Room Seats',
  },
  2: {
    name: 'Silver Clan',
    expRequired: 5000,
    maxMembers: 40,
    maxCoLeaders: 1,
    perk: 'Silver Badge, 1 Co-Leader Slot & +5% Check-in Bonus',
  },
  3: {
    name: 'Gold Clan',
    expRequired: 20000,
    maxMembers: 70,
    maxCoLeaders: 2,
    perk: 'Gold Animated Badge, 2 Co-Leaders & Entrance Banner',
  },
  4: {
    name: 'Diamond Sovereign Clan',
    expRequired: 50000,
    maxMembers: 100,
    maxCoLeaders: 4,
    perk: 'Diamond Royal Halo, 4 Co-Leaders & +20% Check-in Bonus',
  },
};

// Seed default approved families if collection is empty
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
          level: 4,
          exp: 58000,
          ranking: 1,
          diamondsEarned: 1500000,
          leader: leaderId,
          coLeaders: [],
          members: [leaderId],
          memberCount: 28,
          maxMembers: 100,
          approvalStatus: 'approved',
          isActive: true,
          diamondsPaidForCreation: 10000,
        },
        {
          name: 'Galaxy Warriors',
          badgeText: 'GLXY',
          avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200',
          cover: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800',
          notice: 'Reaching for the stars! Friendly community with daily voice parties.',
          slogan: 'Shine brighter than the cosmos!',
          level: 3,
          exp: 24500,
          ranking: 2,
          diamondsEarned: 890000,
          leader: leaderId,
          coLeaders: [],
          members: [leaderId],
          memberCount: 19,
          maxMembers: 70,
          approvalStatus: 'approved',
          isActive: true,
          diamondsPaidForCreation: 10000,
        },
        {
          name: 'Sweet Harmony',
          badgeText: 'HARM',
          avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200',
          cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800',
          notice: 'Music, singing and friendship. Join our cozy rooms every evening!',
          slogan: 'Melodies that bind our souls.',
          level: 2,
          exp: 7200,
          ranking: 3,
          diamondsEarned: 420000,
          leader: leaderId,
          coLeaders: [],
          members: [leaderId],
          memberCount: 14,
          maxMembers: 40,
          approvalStatus: 'approved',
          isActive: true,
          diamondsPaidForCreation: 10000,
        },
      ]);
    }
  }
};

/**
 * Get all approved active families for Ranking / Explore screen
 */
export const getFamilies = async (req: Request, res: Response) => {
  try {
    await seedDefaultFamilies();
    const { search, limit = 50 } = req.query;

    const filter: any = {
      approvalStatus: 'approved',
      isActive: true,
    };

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

    return sendResponse(res, 200, true, 'Approved families retrieved successfully', {
      families,
      levelConfig: CLAN_LEVEL_CONFIG,
    });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch families');
  }
};

/**
 * Get current user's active family (or pending application)
 * + Active voice rooms of clan members ("famly me jo jo hai kisne kisne room open kar rakha hai")
 * + Incoming invitations
 */
export const getMyFamily = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');

    // Find family where user is leader, co-leader, or member
    const family = await Family.findOne({
      $or: [{ members: userId }, { leader: userId }, { coLeaders: userId }],
    })
      .populate('leader', 'name userName avatar level userId gender')
      .populate('coLeaders', 'name userName avatar level userId gender')
      .populate('members', 'name userName avatar level userId gender')
      .populate('joinRequests.user', 'name userName avatar level userId gender')
      .populate('invitations.inviter', 'name userName avatar userId')
      .lean();

    // Query incoming invitations for current user across any approved family
    const incomingInvitations = await Family.find({
      'invitations.invitee': userId,
      'invitations.status': 'pending',
      approvalStatus: 'approved',
      isActive: true,
    })
      .populate('leader', 'name userName avatar level userId')
      .populate('invitations.inviter', 'name userName avatar level userId')
      .select('name badgeText avatar level memberCount ranking invitations')
      .lean();

    const formattedInvites = incomingInvitations.map((fam: any) => {
      const invite = fam.invitations.find(
        (inv: any) => String(inv.invitee) === String(userId) && inv.status === 'pending'
      );
      return {
        familyId: fam._id,
        familyName: fam.name,
        familyAvatar: fam.avatar,
        badgeText: fam.badgeText,
        level: fam.level,
        inviter: invite?.inviter || fam.leader,
        invitedAt: invite?.invitedAt,
        invitationId: invite?._id,
      };
    });

    if (!family) {
      return sendResponse(res, 200, true, 'No family joined', {
        family: null,
        myInvitations: formattedInvites,
        levelConfig: CLAN_LEVEL_CONFIG,
      });
    }

    const isLeader = String((family.leader as any)?._id || family.leader) === String(userId);
    const isCoLeader = (family.coLeaders || []).some(
      (cl: any) => String(cl?._id || cl) === String(userId)
    );

    const todayStr = new Date().toISOString().slice(0, 10);
    const isCheckedInToday = (family.checkins || []).some(
      (chk: any) => String(chk?.user) === String(userId) && chk?.date === todayStr
    );

    // Look up any active voice rooms opened by clan members
    let activeRooms: any[] = [];
    try {
      const memberIds = (family.members || []).map((m: any) => m._id || m);
      activeRooms = await Room.find({
        ownerId: { $in: memberIds },
        isActive: true,
      })
        .populate('ownerId', 'name avatar userId gender level')
        .lean();
    } catch (e: any) {
      console.log('[Family active rooms notice]:', e.message);
    }

    // Pending membership requests (for Leader / Co-Leaders)
    const pendingRequests = (family.joinRequests || []).filter(
      (reqItem: any) => reqItem.status === 'pending'
    );

    const currentLevel = family.level || 1;
    const nextLevelTarget = currentLevel < 4 ? CLAN_LEVEL_CONFIG[currentLevel + 1]?.expRequired : 50000;

    return sendResponse(res, 200, true, 'My family details retrieved', {
      family,
      isLeader,
      isCoLeader,
      isCheckedInToday,
      activeRooms,
      pendingRequests,
      myInvitations: formattedInvites,
      levelConfig: CLAN_LEVEL_CONFIG,
      nextLevelExp: nextLevelTarget,
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
    return sendResponse(res, 200, true, 'Family details retrieved', { family, levelConfig: CLAN_LEVEL_CONFIG });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch family');
  }
};

/**
 * Create a new Family
 * Cost: 10,000 Diamonds
 * Admin Approval: Saved as approvalStatus = 'pending', sends request to Admin Panel
 */
export const createFamily = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');

    const user = await User.findById(userId);
    if (!user) return sendResponse(res, 404, false, 'User not found');

    const CREATION_COST = 10000;
    const userDiamonds = Number(user.diamonds || 0);

    if (userDiamonds < CREATION_COST) {
      return sendResponse(
        res,
        400,
        false,
        `Insufficient Diamonds! Creating a clan requires 10,000 Diamonds. Your balance is ${userDiamonds.toLocaleString()} Diamonds.`
      );
    }

    const { name, badgeText, badge, notice, slogan, avatar, cover } = req.body;
    const finalBadge = (badgeText || badge || 'YARO').trim().toUpperCase();
    const finalName = (name || '').trim();

    if (!finalName) {
      return sendResponse(res, 400, false, 'Family name is required');
    }

    // Check if user is already in an active or pending family
    const existingFamily = await Family.findOne({
      $or: [{ members: userId }, { leader: userId }],
      approvalStatus: { $in: ['pending', 'approved'] },
    });
    if (existingFamily) {
      return sendResponse(
        res,
        400,
        false,
        existingFamily.approvalStatus === 'pending'
          ? 'You already have a clan creation application under review by the Admin team.'
          : 'You are already a member of a clan. Please leave it before creating a new one.'
      );
    }

    const existingName = await Family.findOne({
      name: { $regex: `^${finalName}$`, $options: 'i' },
      approvalStatus: { $in: ['pending', 'approved'] },
    });
    if (existingName) {
      return sendResponse(res, 400, false, 'Family name is already taken. Please choose another name.');
    }

    // Deduct 10,000 Diamonds from user
    user.diamonds = userDiamonds - CREATION_COST;
    await user.save();

    const totalCount = await Family.countDocuments();

    // Create clan in 'pending' status for admin approval
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
      maxMembers: 20, // Level 1 starts with 20 members max
      level: 1,
      exp: 0,
      ranking: totalCount + 1,
      diamondsEarned: 0,
      isActive: false, // Inactive until admin approves
      approvalStatus: 'pending',
      diamondsPaidForCreation: CREATION_COST,
    });

    const populated = await Family.findById(family._id)
      .populate('leader', 'name userName avatar level userId')
      .populate('members', 'name userName avatar level userId')
      .lean();

    return sendResponse(
      res,
      201,
      true,
      'Clan application submitted to Admin Panel! 10,000 Diamonds deducted. Your clan will be active once approved by the Admin team. 👑',
      {
        family: populated,
        remainingDiamonds: user.diamonds,
      }
    );
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to create family');
  }
};

/**
 * Send Join Request to a Family
 */
export const requestJoinFamily = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { id } = req.params;
    const { message } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(res, 400, false, 'Invalid Family ID');
    }

    const family = await Family.findById(id);
    if (!family || !family.isActive || family.approvalStatus !== 'approved') {
      return sendResponse(res, 404, false, 'Family not found or not currently active');
    }

    // Check if user is already in any approved clan
    const alreadyInFamily = await Family.findOne({
      $or: [{ members: userId }, { leader: userId }],
      approvalStatus: 'approved',
      isActive: true,
    });
    if (alreadyInFamily) {
      return sendResponse(res, 400, false, `You are already a member of "${alreadyInFamily.name}". Please leave it first.`);
    }

    // Check clan capacity based on level
    const maxCapacity = family.maxMembers || CLAN_LEVEL_CONFIG[family.level || 1]?.maxMembers || 20;
    if (family.members.length >= maxCapacity) {
      return sendResponse(res, 400, false, 'This clan has reached its maximum member capacity for its current level.');
    }

    // Check if already requested
    const existingReq = family.joinRequests.find(
      (r) => String(r.user) === String(userId) && r.status === 'pending'
    );
    if (existingReq) {
      return sendResponse(res, 400, false, 'You already have a pending join request with this clan.');
    }

    family.joinRequests.push({
      user: userId,
      message: message || 'I would love to join your clan!',
      requestedAt: new Date(),
      status: 'pending',
    });

    await family.save();

    return sendResponse(res, 200, true, `Join request sent to "${family.name}" leadership! 🛡️`, {
      familyId: family._id,
    });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to send join request');
  }
};

/**
 * Leader / Co-Leader handles Join Request (Accept / Reject)
 */
export const handleJoinRequest = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { id, requestId } = req.params;
    const { action } = req.body; // 'accept' | 'reject'

    const family = await Family.findById(id);
    if (!family || !family.isActive) {
      return sendResponse(res, 404, false, 'Family not found');
    }

    const isLeader = String(family.leader) === String(userId);
    const isCoLeader = family.coLeaders.some((cl) => String(cl) === String(userId));
    if (!isLeader && !isCoLeader) {
      return sendResponse(res, 403, false, 'Only the Clan Leader or Co-Leaders can handle join requests');
    }

    const reqItem = family.joinRequests.find((r) => String(r._id) === String(requestId));
    if (!reqItem || reqItem.status !== 'pending') {
      return sendResponse(res, 404, false, 'Request not found or already processed');
    }

    if (action === 'reject') {
      reqItem.status = 'rejected';
      await family.save();
      return sendResponse(res, 200, true, 'Join request rejected');
    }

    if (action === 'accept') {
      // Check capacity
      const maxCapacity = family.maxMembers || CLAN_LEVEL_CONFIG[family.level || 1]?.maxMembers || 20;
      if (family.members.length >= maxCapacity) {
        return sendResponse(res, 400, false, `Clan is full at Lv.${family.level} capacity (${maxCapacity} members).`);
      }

      // Check applicant isn't in another clan
      const applicantId = reqItem.user;
      const otherClan = await Family.findOne({
        _id: { $ne: family._id },
        $or: [{ members: applicantId }, { leader: applicantId }],
        approvalStatus: 'approved',
        isActive: true,
      });
      if (otherClan) {
        reqItem.status = 'rejected';
        await family.save();
        return sendResponse(res, 400, false, 'Applicant has already joined another clan.');
      }

      if (!family.members.some((m) => String(m) === String(applicantId))) {
        family.members.push(applicantId);
        family.memberCount = family.members.length;
      }
      reqItem.status = 'accepted';
      await family.save();

      return sendResponse(res, 200, true, 'Member welcomed into the clan! 🎉', {
        memberCount: family.memberCount,
      });
    }

    return sendResponse(res, 400, false, 'Invalid action');
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to process request');
  }
};

/**
 * Leader / Co-Leader invites a user to the clan by Numeric ID
 */
export const inviteToFamily = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { id } = req.params;
    const { targetNumericId, targetId } = req.body;

    const family = await Family.findById(id);
    if (!family || !family.isActive || family.approvalStatus !== 'approved') {
      return sendResponse(res, 404, false, 'Family not found or not active');
    }

    const isLeader = String(family.leader) === String(userId);
    const isCoLeader = family.coLeaders.some((cl) => String(cl) === String(userId));
    if (!isLeader && !isCoLeader) {
      return sendResponse(res, 403, false, 'Only Clan Leader or Co-Leaders can invite members');
    }

    const lookupQuery = targetNumericId
      ? { userId: Number(targetNumericId) }
      : { _id: targetId };

    const targetUser = await User.findOne(lookupQuery);
    if (!targetUser) {
      return sendResponse(res, 404, false, 'User not found. Please verify the numeric ID.');
    }

    if (String(targetUser._id) === String(userId)) {
      return sendResponse(res, 400, false, 'You cannot invite yourself');
    }

    // Check if target is already in clan
    if (family.members.some((m) => String(m) === String(targetUser._id))) {
      return sendResponse(res, 400, false, 'User is already a member of this clan');
    }

    // Check if already invited
    const existingInvite = family.invitations.find(
      (inv) => String(inv.invitee) === String(targetUser._id) && inv.status === 'pending'
    );
    if (existingInvite) {
      return sendResponse(res, 400, false, 'An invitation has already been sent to this user.');
    }

    family.invitations.push({
      invitee: targetUser._id as any,
      inviter: userId,
      invitedAt: new Date(),
      status: 'pending',
    });

    await family.save();

    return sendResponse(res, 200, true, `Invitation sent to ${targetUser.name || 'user'}! 💌`, {
      targetUserName: targetUser.name,
      targetUserId: targetUser.userId,
    });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to send invitation');
  }
};

/**
 * Invitee responds to clan invitation (Accept / Decline)
 */
export const respondFamilyInvitation = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { familyId, invitationId } = req.params;
    const { action } = req.body; // 'accept' | 'decline'

    const family = await Family.findById(familyId);
    if (!family || !family.isActive || family.approvalStatus !== 'approved') {
      return sendResponse(res, 404, false, 'Clan not found or inactive');
    }

    const invite = family.invitations.find(
      (inv) => String(inv._id) === String(invitationId) && String(inv.invitee) === String(userId)
    );
    if (!invite || invite.status !== 'pending') {
      return sendResponse(res, 404, false, 'Invitation not found or already processed');
    }

    if (action === 'decline' || action === 'reject') {
      invite.status = 'rejected';
      await family.save();
      return sendResponse(res, 200, true, 'Clan invitation declined.');
    }

    if (action === 'accept') {
      // Check user not in another clan
      const inClan = await Family.findOne({
        _id: { $ne: family._id },
        $or: [{ members: userId }, { leader: userId }],
        approvalStatus: 'approved',
        isActive: true,
      });
      if (inClan) {
        return sendResponse(res, 400, false, `You are already in "${inClan.name}". Please leave it first.`);
      }

      // Check capacity
      const maxCapacity = family.maxMembers || CLAN_LEVEL_CONFIG[family.level || 1]?.maxMembers || 20;
      if (family.members.length >= maxCapacity) {
        return sendResponse(res, 400, false, 'This clan is full.');
      }

      if (!family.members.some((m) => String(m) === String(userId))) {
        family.members.push(userId);
        family.memberCount = family.members.length;
      }
      invite.status = 'accepted';
      await family.save();

      return sendResponse(res, 200, true, `Joined "${family.name}"! Welcome to the clan! 👑`, {
        family,
      });
    }

    return sendResponse(res, 400, false, 'Invalid response action');
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to respond to invitation');
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

    if (isLeader && family.members.length <= 1) {
      family.isActive = false;
      await family.save();
      return sendResponse(res, 200, true, 'You were the last member. Family has been dissolved.');
    }

    if (isLeader) {
      const nextLeaderId = family.coLeaders.length > 0
        ? family.coLeaders[0]
        : family.members.find((m) => String(m) !== String(userId));

      if (nextLeaderId) {
        family.leader = nextLeaderId;
        family.coLeaders = family.coLeaders.filter((cl) => String(cl) !== String(nextLeaderId));
      }
    }

    family.coLeaders = family.coLeaders.filter((cl) => String(cl) !== String(userId));
    family.members = family.members.filter((m) => String(m) !== String(userId));
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
    const { action } = req.body;

    const family = await Family.findById(id);
    if (!family || !family.isActive) {
      return sendResponse(res, 404, false, 'Family not found');
    }

    const isLeader = String(family.leader) === String(userId);
    const isCoLeader = family.coLeaders.some((cl) => String(cl) === String(userId));

    if (!isLeader && !isCoLeader) {
      return sendResponse(res, 403, false, 'Only the Leader or Co-Leaders can manage members');
    }

    if (String(memberId) === String(family.leader)) {
      return sendResponse(res, 400, false, 'Cannot perform this action on the family leader');
    }

    if (action === 'kick') {
      if (!isLeader && family.coLeaders.some((cl) => String(cl) === String(memberId))) {
        return sendResponse(res, 403, false, 'Co-Leaders can only be kicked by the Leader');
      }
      family.members = family.members.filter((m) => String(m) !== String(memberId));
      family.coLeaders = family.coLeaders.filter((cl) => String(cl) !== String(memberId));
      family.memberCount = family.members.length;
      await family.save();
      return sendResponse(res, 200, true, 'Member kicked from family');
    }

    if (!isLeader) {
      return sendResponse(res, 403, false, 'Only the Family Leader can promote or transfer leadership');
    }

    // Check co-leader limit based on Level
    const maxCoLeaders = CLAN_LEVEL_CONFIG[family.level || 1]?.maxCoLeaders || 0;

    if (action === 'promote_co_leader') {
      if (family.coLeaders.length >= maxCoLeaders) {
        return sendResponse(
          res,
          400,
          false,
          `At Lv.${family.level}, your clan can have a maximum of ${maxCoLeaders} Co-Leader(s). Upgrade clan level to unlock more slots!`
        );
      }
      if (!family.coLeaders.some((cl) => String(cl) === String(memberId))) {
        family.coLeaders.push(new mongoose.Types.ObjectId(memberId));
        await family.save();
      }
      return sendResponse(res, 200, true, 'Member promoted to Co-Leader! ⭐');
    }

    if (action === 'demote_co_leader') {
      family.coLeaders = family.coLeaders.filter((cl) => String(cl) !== String(memberId));
      await family.save();
      return sendResponse(res, 200, true, 'Co-Leader demoted to regular member');
    }

    if (action === 'transfer_leader') {
      family.coLeaders = family.coLeaders.filter((cl) => String(cl) !== String(memberId));
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
 * Daily Clan Check-in (Roll Call)
 * Grants +50 EXP and +10 clan diamonds
 * Auto checks level up according to 4 levels!
 */
export const familyCheckin = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');

    const family = await Family.findOne({
      $or: [{ members: userId }, { leader: userId }, { coLeaders: userId }],
      approvalStatus: 'approved',
      isActive: true,
    });

    if (!family) {
      return sendResponse(res, 404, false, 'You are not part of an active approved clan');
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const alreadyCheckedIn = (family.checkins || []).some(
      (chk: any) => String(chk?.user) === String(userId) && chk?.date === todayStr
    );

    if (alreadyCheckedIn) {
      return sendResponse(res, 400, false, 'Already completed family check-in today! Come back tomorrow.');
    }

    const expGain = 50;
    const diamondsGain = 10;

    family.checkins.push({
      user: userId,
      date: todayStr,
    });

    family.exp = (family.exp || 0) + expGain;
    family.diamondsEarned = (family.diamondsEarned || 0) + diamondsGain;

    // Check level progression across the 4 levels:
    // Level 1: 0, Level 2: 5000, Level 3: 20000, Level 4: 50000
    let currentLevel = family.level || 1;
    let leveledUp = false;

    if (currentLevel < 4) {
      const nextLevel = (currentLevel + 1) as 2 | 3 | 4;
      const targetExp = CLAN_LEVEL_CONFIG[nextLevel]?.expRequired || 50000;
      if (family.exp >= targetExp) {
        family.level = nextLevel;
        family.maxMembers = CLAN_LEVEL_CONFIG[nextLevel]?.maxMembers || 100;
        leveledUp = true;
      }
    }

    await family.save();

    return sendResponse(
      res,
      200,
      true,
      leveledUp
        ? `Check-in complete! Clan leveled up to Lv.${family.level} (${CLAN_LEVEL_CONFIG[family.level]?.name})! 🌟`
        : 'Clan roll call complete! +50 EXP & +10 Diamonds earned ✨',
      {
        familyLevel: family.level,
        familyExp: family.exp,
        diamondsEarned: family.diamondsEarned,
        leveledUp,
      }
    );
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Check-in failed');
  }
};

/**
 * Update family announcement
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
    const isCoLeader = family.coLeaders.some((cl) => String(cl) === String(userId));
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

/**
 * Fetch or auto-seed Official Customer Support Voice Room
 */
export const getSupportRoom = async (req: Request, res: Response) => {
  try {
    let supportRoom = await Room.findOne({
      $or: [{ category: 'Support' }, { title: { $regex: 'Customer Support|Help & Support', $options: 'i' } }],
      isActive: true,
    })
      .populate('ownerId', 'name avatar userId')
      .lean();

    if (!supportRoom) {
      // Find admin or any host
      const hostUser: any = await User.findOne({ role: { $in: ['admin', 'superAdmin', 'owner'] } }) || await User.findOne({});
      const hostId = hostUser ? hostUser._id : new mongoose.Types.ObjectId();
      const hostUserId = hostUser?.userId ? String(hostUser.userId) : '100001';

      supportRoom = await Room.create({
        ownerId: hostId,
        channelName: `support_room_${hostUserId}`,
        roomId: `support_room_${hostUserId}`,
        title: '🎧 24/7 Official Customer Help & Support',
        category: 'Support',
        about: 'Official support center for Yaro users. Ask any questions about accounts, gifts, rooms, or clans!',
        mode: 'Public',
        seatCount: 8,
        isActive: true,
        coverImage: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500',
      }) as any;
    }

    return sendResponse(res, 200, true, 'Customer support room retrieved', { room: supportRoom });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch support room');
  }
};

// Admin Controller Functions
export const adminGetFamilies = async (req: Request, res: Response) => {
  try {
    await seedDefaultFamilies();
    const { status } = req.query;
    const filter: any = {};
    if (status && typeof status === 'string') {
      filter.approvalStatus = status;
    }

    const families = await Family.find(filter)
      .populate('leader', 'name userName email phone avatar userId diamonds')
      .sort({ createdAt: -1 })
      .lean();
    return sendResponse(res, 200, true, 'Admin families retrieved', { families });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch families for admin');
  }
};

export const adminApproveFamily = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const family = await Family.findById(id);
    if (!family) return sendResponse(res, 404, false, 'Family not found');

    family.approvalStatus = 'approved';
    family.isActive = true;
    await family.save();

    return sendResponse(res, 200, true, `Clan "${family.name}" approved successfully! 👑`, { family });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to approve family');
  }
};

export const adminRejectFamily = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const family = await Family.findById(id);
    if (!family) return sendResponse(res, 404, false, 'Family not found');

    family.approvalStatus = 'rejected';
    family.isActive = false;
    family.rejectionReason = reason || 'Clan creation guidelines not met';
    await family.save();

    // Refund 10,000 diamonds back to creator!
    const refundAmount = family.diamondsPaidForCreation || 10000;
    await User.findByIdAndUpdate(family.leader, {
      $inc: { diamonds: refundAmount },
    });

    return sendResponse(res, 200, true, `Clan rejected. ${refundAmount} Diamonds refunded to applicant.`, { family });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to reject family');
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
