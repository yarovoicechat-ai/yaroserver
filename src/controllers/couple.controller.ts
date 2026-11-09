import { Request, Response } from 'express';
import Couple, { CoupleProposal } from '../models/couple.model';
import sendResponse from '../utils/reponse';
import { User } from '../models/user.model';
import mongoose from 'mongoose';

const seedDefaultCouples = async () => {
  const count = await Couple.countDocuments();
  if (count === 0) {
    const users = await User.find({}).limit(4).select('_id');
    if (users.length >= 2) {
      await Couple.create([
        {
          user1: users[0]._id,
          user2: users[1]._id,
          ringName: 'Eternal Diamond Ring',
          ringImage: 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=200',
          intimacyScore: 99999,
          cpLevel: 10,
          cpTitle: 'Eternal Soulmates',
          status: 'active',
          anniversaryDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
          loveWall: [
            {
              sender: users[0]._id,
              text: 'You are my universe. Happy 6 months anniversary my love! ❤️',
              createdAt: new Date(),
            },
          ],
        },
      ]);
    }
  }
};

/**
 * Get active couples leaderboard
 */
export const getCouples = async (req: Request, res: Response) => {
  try {
    await seedDefaultCouples();
    const couples = await Couple.find({ status: 'active' })
      .populate('user1', 'name userName avatar level userId gender')
      .populate('user2', 'name userName avatar level userId gender')
      .sort({ intimacyScore: -1, cpLevel: -1 })
      .lean();

    return sendResponse(res, 200, true, 'CP couples retrieved successfully', { couples });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch CP couples');
  }
};

/**
 * Get current user's CP details and pending proposals
 */
export const getMyCp = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');

    const couple = await Couple.findOne({
      $or: [{ user1: userId }, { user2: userId }],
      status: 'active',
    })
      .populate('user1', 'name userName avatar level userId gender')
      .populate('user2', 'name userName avatar level userId gender')
      .populate('loveWall.sender', 'name userName avatar level userId')
      .lean();

    let partner: any = null;
    let daysTogether = 0;
    let isCheckedInToday = false;
    let nextLevelIntimacy = 1000;

    const todayStr = new Date().toISOString().slice(0, 10);

    if (couple) {
      const isUser1 = String((couple.user1 as any)?._id || couple.user1) === String(userId);
      partner = isUser1 ? couple.user2 : couple.user1;

      const anniversary = new Date(couple.anniversaryDate || couple.createdAt);
      daysTogether = Math.max(1, Math.floor((Date.now() - anniversary.getTime()) / (1000 * 60 * 60 * 24)));

      if (couple.lastCheckinDate) {
        isCheckedInToday = new Date(couple.lastCheckinDate).toISOString().slice(0, 10) === todayStr;
      }

      nextLevelIntimacy = Math.max(1000, (couple.cpLevel || 1) * 2000);
    }

    // Get incoming proposals for this user
    const incomingProposals = await CoupleProposal.find({
      receiver: userId,
      status: 'pending',
    })
      .populate('sender', 'name userName avatar level userId gender')
      .sort({ createdAt: -1 })
      .lean();

    // Get outgoing proposals
    const outgoingProposals = await CoupleProposal.find({
      sender: userId,
      status: 'pending',
    })
      .populate('receiver', 'name userName avatar level userId gender')
      .sort({ createdAt: -1 })
      .lean();

    return sendResponse(res, 200, true, 'User CP retrieved', {
      couple,
      partner,
      daysTogether,
      isCheckedInToday,
      nextLevelIntimacy,
      incomingProposals,
      outgoingProposals,
    });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch user CP');
  }
};

/**
 * Send a romantic CP Proposal
 */
export const proposeCp = async (req: any, res: Response) => {
  try {
    const senderId = req.user?.id || req.user?._id;
    if (!senderId) return sendResponse(res, 401, false, 'Unauthorized');

    const { partnerNumericId, partnerId, ringName, ringImage, message } = req.body;
    const lookupTarget = partnerNumericId || partnerId;

    if (!lookupTarget) {
      return sendResponse(res, 400, false, 'Please enter partner numeric ID or select a user');
    }

    // Check if sender already has an active CP
    const activeSenderCp = await Couple.findOne({
      $or: [{ user1: senderId }, { user2: senderId }],
      status: 'active',
    });
    if (activeSenderCp) {
      return sendResponse(res, 400, false, 'You already have an active CP! Please dissolve it first if you wish to propose to someone else.');
    }

    // Find target user
    let targetUser = null;
    if (!isNaN(Number(lookupTarget))) {
      targetUser = await User.findOne({ userId: Number(lookupTarget) });
    }
    if (!targetUser && mongoose.Types.ObjectId.isValid(lookupTarget)) {
      targetUser = await User.findById(lookupTarget);
    }
    if (!targetUser) {
      targetUser = await User.findOne({ userName: lookupTarget.trim() });
    }

    if (!targetUser) {
      return sendResponse(res, 404, false, 'User not found. Please verify the numeric ID.');
    }

    const receiverId = targetUser._id;

    if (String(receiverId) === String(senderId)) {
      return sendResponse(res, 400, false, 'You cannot propose to yourself! 💕');
    }

    // Check if partner already has an active CP
    const activePartnerCp = await Couple.findOne({
      $or: [{ user1: receiverId }, { user2: receiverId }],
      status: 'active',
    });
    if (activePartnerCp) {
      return sendResponse(res, 400, false, `${targetUser.name || 'This user'} already has an active CP partner.`);
    }

    // Check if proposal already pending
    const existingProposal = await CoupleProposal.findOne({
      sender: senderId,
      receiver: receiverId,
      status: 'pending',
    });
    if (existingProposal) {
      return sendResponse(res, 400, false, 'You already have a pending proposal to this user.');
    }

    const proposal = await CoupleProposal.create({
      sender: senderId,
      receiver: receiverId,
      ringName: ringName || 'Eternal Promise Ring',
      ringImage: ringImage || 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=200',
      message: message || 'Will you be my CP and share your journey with me? ❤️',
      status: 'pending',
    });

    const populatedProposal = await CoupleProposal.findById(proposal._id)
      .populate('receiver', 'name userName avatar level userId')
      .lean();

    return sendResponse(res, 201, true, `Proposal sent to ${targetUser.name || 'partner'}! 💌💍`, {
      proposal: populatedProposal,
    });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to send proposal');
  }
};

/**
 * Get pending proposals for current user
 */
export const getPendingProposals = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');

    const incoming = await CoupleProposal.find({
      receiver: userId,
      status: 'pending',
    })
      .populate('sender', 'name userName avatar level userId gender')
      .sort({ createdAt: -1 })
      .lean();

    const outgoing = await CoupleProposal.find({
      sender: userId,
      status: 'pending',
    })
      .populate('receiver', 'name userName avatar level userId gender')
      .sort({ createdAt: -1 })
      .lean();

    return sendResponse(res, 200, true, 'Proposals retrieved', { incoming, outgoing });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch proposals');
  }
};

/**
 * Respond to a CP Proposal (Accept / Decline)
 */
export const respondProposal = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { proposalId } = req.params;
    const { action } = req.body; // 'accept' | 'decline'

    if (!mongoose.Types.ObjectId.isValid(proposalId)) {
      return sendResponse(res, 400, false, 'Invalid proposal ID');
    }

    const proposal = await CoupleProposal.findById(proposalId);
    if (!proposal || proposal.status !== 'pending') {
      return sendResponse(res, 404, false, 'Proposal not found or already handled');
    }

    if (String(proposal.receiver) !== String(userId)) {
      return sendResponse(res, 403, false, 'You can only respond to proposals sent to you');
    }

    if (action === 'decline' || action === 'reject') {
      proposal.status = 'declined';
      await proposal.save();
      return sendResponse(res, 200, true, 'Proposal declined.');
    }

    if (action === 'accept') {
      // Ensure neither user currently has active CP
      const conflict = await Couple.findOne({
        $or: [
          { user1: proposal.sender },
          { user2: proposal.sender },
          { user1: proposal.receiver },
          { user2: proposal.receiver },
        ],
        status: 'active',
      });
      if (conflict) {
        return sendResponse(res, 400, false, 'One of the parties is already in an active CP bond.');
      }

      // Establish couple!
      const couple = await Couple.create({
        user1: proposal.sender,
        user2: proposal.receiver,
        ringName: proposal.ringName || 'Diamond Promise Ring',
        ringImage: proposal.ringImage || 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=200',
        intimacyScore: 520,
        cpLevel: 1,
        anniversaryDate: new Date(),
        status: 'active',
        cpTitle: 'Eternal Soulmates',
        loveWall: [
          {
            sender: proposal.sender,
            text: proposal.message || 'Our romantic story begins today! ❤️',
            createdAt: new Date(),
          },
        ],
      });

      proposal.status = 'accepted';
      await proposal.save();

      // Decline any other pending proposals for both users
      await CoupleProposal.updateMany(
        {
          _id: { $ne: proposal._id },
          $or: [
            { sender: proposal.sender },
            { receiver: proposal.sender },
            { sender: proposal.receiver },
            { receiver: proposal.receiver },
          ],
          status: 'pending',
        },
        { status: 'declined' }
      );

      const populatedCouple = await Couple.findById(couple._id)
        .populate('user1', 'name userName avatar level userId')
        .populate('user2', 'name userName avatar level userId')
        .lean();

      return sendResponse(res, 200, true, 'Proposal accepted! Happy Anniversary! 💍💖', { couple: populatedCouple });
    }

    return sendResponse(res, 400, false, 'Invalid response action');
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to respond to proposal');
  }
};

/**
 * Daily CP Love Check-in
 */
export const cpCheckin = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');

    const couple = await Couple.findOne({
      $or: [{ user1: userId }, { user2: userId }],
      status: 'active',
    });

    if (!couple) {
      return sendResponse(res, 404, false, 'No active CP found');
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    if (couple.lastCheckinDate) {
      const lastStr = new Date(couple.lastCheckinDate).toISOString().slice(0, 10);
      if (lastStr === todayStr) {
        return sendResponse(res, 400, false, 'Already completed your CP love check-in today! 💕');
      }
    }

    const intimacyGain = 100;
    couple.intimacyScore = (couple.intimacyScore || 0) + intimacyGain;
    couple.lastCheckinDate = new Date();

    // Check level up
    const nextLevelReq = couple.cpLevel * 2000;
    let leveledUp = false;
    if (couple.intimacyScore >= nextLevelReq) {
      couple.cpLevel += 1;
      leveledUp = true;
    }

    await couple.save();

    return sendResponse(res, 200, true, leveledUp ? `Check-in complete! Your CP intimacy leveled up to Lv.${couple.cpLevel}! 💖✨` : 'Sweet check-in complete! +100 Intimacy Points added 💖', {
      intimacyScore: couple.intimacyScore,
      cpLevel: couple.cpLevel,
      leveledUp,
    });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'CP check-in failed');
  }
};

/**
 * Post a romantic message / memory on the CP Love Wall
 */
export const postLoveWallMessage = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return sendResponse(res, 400, false, 'Message text is required');
    }

    const couple = await Couple.findOne({
      $or: [{ user1: userId }, { user2: userId }],
      status: 'active',
    });

    if (!couple) {
      return sendResponse(res, 404, false, 'No active CP found');
    }

    const newNote = {
      sender: userId,
      text: text.trim(),
      createdAt: new Date(),
    };

    couple.loveWall.unshift(newNote as any);
    if (couple.loveWall.length > 50) {
      couple.loveWall = couple.loveWall.slice(0, 50);
    }

    // Add +20 intimacy for posting a memory
    couple.intimacyScore = (couple.intimacyScore || 0) + 20;

    await couple.save();

    const updated = await Couple.findById(couple._id)
      .populate('loveWall.sender', 'name userName avatar level userId')
      .lean();

    return sendResponse(res, 201, true, 'Love note posted to your CP Space! 💌', {
      loveWall: updated?.loveWall || [],
      intimacyScore: couple.intimacyScore,
    });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to post love message');
  }
};

/**
 * Upgrade Couple Ring
 */
export const upgradeRing = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { ringName, ringImage, tier = 2 } = req.body;

    const couple = await Couple.findOne({
      $or: [{ user1: userId }, { user2: userId }],
      status: 'active',
    });

    if (!couple) {
      return sendResponse(res, 404, false, 'No active CP found');
    }

    if (ringName) couple.ringName = ringName;
    if (ringImage) couple.ringImage = ringImage;
    couple.ringTier = Number(tier);
    couple.intimacyScore = (couple.intimacyScore || 0) + 500; // Bonus intimacy

    await couple.save();

    return sendResponse(res, 200, true, `Ring upgraded to "${couple.ringName}"! 💍✨ (+500 Intimacy)`, {
      ringName: couple.ringName,
      ringImage: couple.ringImage,
      ringTier: couple.ringTier,
      intimacyScore: couple.intimacyScore,
    });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to upgrade ring');
  }
};

/**
 * Break up / dissolve CP
 */
export const dissolveCp = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const couple = await Couple.findOne({
      $or: [{ user1: userId }, { user2: userId }],
      status: 'active',
    });
    if (!couple) return sendResponse(res, 404, false, 'No active CP found');

    couple.status = 'broken';
    await couple.save();

    return sendResponse(res, 200, true, 'Your CP relationship has been dissolved.');
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to dissolve CP');
  }
};

// Admin Controller Functions
export const adminGetCouples = async (req: Request, res: Response) => {
  try {
    await seedDefaultCouples();
    const couples = await Couple.find()
      .populate('user1', 'name userName email phone avatar')
      .populate('user2', 'name userName email phone avatar')
      .sort({ createdAt: -1 })
      .lean();
    return sendResponse(res, 200, true, 'Admin CP couples retrieved', { couples });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch couples for admin');
  }
};

export const adminUpdateCouple = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const update = { ...req.body };
    const updated = await Couple.findByIdAndUpdate(id, update, { new: true });
    if (!updated) return sendResponse(res, 404, false, 'Couple not found');
    return sendResponse(res, 200, true, 'Couple updated successfully', updated);
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to update couple');
  }
};

export const adminDeleteCouple = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await Couple.findByIdAndDelete(id);
    if (!deleted) return sendResponse(res, 404, false, 'Couple not found');
    return sendResponse(res, 200, true, 'Couple deleted successfully', { id });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to delete couple');
  }
};
