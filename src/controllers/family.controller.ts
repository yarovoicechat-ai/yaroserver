import { Request, Response } from 'express';
import Family from '../models/family.model';
import sendResponse from '../utils/reponse';
import { User } from '../models/user.model';

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
          notice: 'Top clan in Yaro. Only elite gifters and high-level callers allowed!',
          level: 10,
          ranking: 1,
          diamondsEarned: 1500000,
          leader: leaderId,
          members: [leaderId],
          memberCount: 28,
        },
        {
          name: 'Galaxy Warriors',
          badgeText: 'GLXY',
          avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200',
          notice: 'Reaching for the stars! Friendly community with daily voice parties.',
          level: 7,
          ranking: 2,
          diamondsEarned: 890000,
          leader: leaderId,
          members: [leaderId],
          memberCount: 19,
        },
        {
          name: 'Sweet Harmony',
          badgeText: 'HARM',
          avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200',
          notice: 'Music, singing and friendship. Join our cozy rooms every evening!',
          level: 5,
          ranking: 3,
          diamondsEarned: 420000,
          leader: leaderId,
          members: [leaderId],
          memberCount: 14,
        },
      ]);
    }
  }
};

export const getFamilies = async (req: Request, res: Response) => {
  try {
    await seedDefaultFamilies();
    const { search, limit = 50 } = req.query;
    const filter: any = { isActive: true };
    if (search && typeof search === 'string' && search.trim()) {
      filter.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { badgeText: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    const families = await Family.find(filter)
      .populate('leader', 'name userName avatar')
      .sort({ ranking: 1, diamondsEarned: -1 })
      .limit(Number(limit))
      .lean();

    return sendResponse(res, 200, true, 'Families retrieved successfully', { families });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch families');
  }
};

export const getFamilyById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const family = await Family.findById(id)
      .populate('leader', 'name userName avatar level')
      .populate('members', 'name userName avatar level')
      .lean();
    if (!family) {
      return sendResponse(res, 404, false, 'Family not found');
    }
    return sendResponse(res, 200, true, 'Family details retrieved', family);
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch family');
  }
};

export const createFamily = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { name, badgeText, notice, avatar } = req.body;

    if (!name || !badgeText) {
      return sendResponse(res, 400, false, 'Family name and badge text are required');
    }

    const existing = await Family.findOne({ name: name.trim() });
    if (existing) {
      return sendResponse(res, 400, false, 'Family name already taken');
    }

    const family = await Family.create({
      name: name.trim(),
      badgeText: badgeText.trim().toUpperCase(),
      notice: notice || 'Welcome to our Family!',
      avatar: avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200',
      leader: userId,
      members: [userId],
      memberCount: 1,
    });

    return sendResponse(res, 201, true, 'Family created successfully! 🎉', family);
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to create family');
  }
};

export const joinFamily = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { id } = req.params;

    const family = await Family.findById(id);
    if (!family) return sendResponse(res, 404, false, 'Family not found');

    const isMember = family.members.some(m => String(m) === String(userId));
    if (isMember) return sendResponse(res, 400, false, 'Already a member of this family');

    family.members.push(userId);
    family.memberCount = family.members.length;
    await family.save();

    return sendResponse(res, 200, true, 'Joined family successfully!', family);
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to join family');
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
