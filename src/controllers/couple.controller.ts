import { Request, Response } from 'express';
import Couple from '../models/couple.model';
import sendResponse from '../utils/reponse';
import { User } from '../models/user.model';

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

export const getCouples = async (req: Request, res: Response) => {
  try {
    await seedDefaultCouples();
    const couples = await Couple.find({ status: 'active' })
      .populate('user1', 'name userName avatar level')
      .populate('user2', 'name userName avatar level')
      .sort({ intimacyScore: -1, cpLevel: -1 })
      .lean();
    return sendResponse(res, 200, true, 'CP couples retrieved successfully', { couples });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch CP couples');
  }
};

export const getMyCp = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');

    const couple = await Couple.findOne({
      $or: [{ user1: userId }, { user2: userId }],
      status: 'active',
    })
      .populate('user1', 'name userName avatar level')
      .populate('user2', 'name userName avatar level')
      .lean();

    return sendResponse(res, 200, true, 'User CP retrieved', { couple });
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch user CP');
  }
};

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

    return sendResponse(res, 200, true, 'CP dissolved successfully');
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
