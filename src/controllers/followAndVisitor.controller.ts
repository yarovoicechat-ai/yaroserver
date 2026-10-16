import { Response } from "express";
import mongoose from "mongoose";
import { User } from "../models/user.model";
import { ProfileVisitor } from "../models/profileVisitor.model";
import { createNotification } from "./notificationController";
import sendResponse from "../utils/reponse";
import { AuthRequest } from "../middlewares/authorize.middleware";

// Helper to resolve user by MongoDB ObjectId or numeric userId
const resolveUser = async (identifier: string | number) => {
  if (!identifier) return null;
  const strId = String(identifier).trim();
  if (mongoose.Types.ObjectId.isValid(strId)) {
    const byMongoId = await User.findById(strId);
    if (byMongoId) return byMongoId;
  }
  const numericId = Number(strId);
  if (!isNaN(numericId)) {
    const byNumericId = await User.findOne({ userId: numericId });
    if (byNumericId) return byNumericId;
  }
  return User.findOne({
    $or: [
      { equippedCustomId: strId },
      { equippedVipId: strId },
      { userName: strId },
    ],
  });
};

/**
 * POST /api/user/follow/:id
 * Toggle follow/unfollow for target user
 */
export const followUser = async (req: AuthRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id || (req.user as any)?._id;
    const { id: targetIdentifier } = req.params;

    if (!currentUserId) {
      return sendResponse(res, 401, false, "Unauthorized");
    }

    if (!targetIdentifier) {
      return sendResponse(res, 400, false, "Target user ID is required");
    }

    const currentUser = await User.findById(currentUserId);
    const targetUser = await resolveUser(targetIdentifier);

    if (!currentUser || !targetUser) {
      return sendResponse(res, 404, false, "User not found");
    }

    if (String(currentUser._id) === String(targetUser._id)) {
      return sendResponse(res, 400, false, "You cannot follow yourself");
    }

    const currentFollowing = (currentUser.following || []).map(String);
    const targetFollowers = (targetUser.followers || []).map(String);
    const isCurrentlyFollowing = currentFollowing.includes(String(targetUser._id));

    if (isCurrentlyFollowing) {
      // Unfollow logic
      await User.findByIdAndUpdate(currentUser._id, {
        $pull: { following: targetUser._id },
        $inc: { followingCount: -1 },
      });
      const updatedTarget = await User.findByIdAndUpdate(
        targetUser._id,
        {
          $pull: { followers: currentUser._id },
          $inc: { followersCount: -1 },
        },
        { new: true }
      );

      // Clamp counts to 0 minimum
      if ((updatedTarget?.followersCount || 0) < 0) {
        await User.findByIdAndUpdate(targetUser._id, { $set: { followersCount: 0 } });
      }

      return sendResponse(res, 200, true, "Unfollowed successfully", {
        isFollowing: false,
        followersCount: Math.max(0, (updatedTarget?.followersCount || 1) - 1),
      });
    } else {
      // Follow logic
      await User.findByIdAndUpdate(currentUser._id, {
        $addToSet: { following: targetUser._id },
        $inc: { followingCount: 1 },
      });
      const updatedTarget = await User.findByIdAndUpdate(
        targetUser._id,
        {
          $addToSet: { followers: currentUser._id },
          $inc: { followersCount: 1 },
        },
        { new: true }
      );

      // Check if target user is already following current user (Mutual follow / friendship)
      const targetFollowing = (targetUser.following || []).map(String);
      const isMutual = targetFollowing.includes(String(currentUser._id));

      if (isMutual) {
        // Notification for target user: Follow back / Mutual friend
        await createNotification(
          String(targetUser._id),
          "New Friend 🤝",
          `${currentUser.name || "A user"} followed you back! You are now friends.`,
          "follow",
          {
            followerId: currentUser._id,
            followerUserId: currentUser.userId,
            followerName: currentUser.name || "User",
            followerAvatar: currentUser.image || "",
            isMutual: true,
          }
        );

        // Notification for current user
        await createNotification(
          String(currentUser._id),
          "Mutual Follow 💫",
          `You and ${targetUser.name || "User"} are now following each other!`,
          "follow",
          {
            followerId: targetUser._id,
            followerUserId: targetUser.userId,
            followerName: targetUser.name || "User",
            followerAvatar: targetUser.image || "",
            isMutual: true,
          }
        );
      } else {
        // Notification for target user: New follower
        await createNotification(
          String(targetUser._id),
          "New Follower ✨",
          `${currentUser.name || "A user"} started following you.`,
          "follow",
          {
            followerId: currentUser._id,
            followerUserId: currentUser.userId,
            followerName: currentUser.name || "User",
            followerAvatar: currentUser.image || "",
            isMutual: false,
          }
        );
      }

      return sendResponse(res, 200, true, "Followed successfully", {
        isFollowing: true,
        isMutual,
        followersCount: updatedTarget?.followersCount || 1,
      });
    }
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || "Failed to update follow status");
  }
};

/**
 * GET /api/user/followers
 * Returns paginated followers of the current user (or query userId)
 */
export const getFollowers = async (req: AuthRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id || (req.user as any)?._id;
    const targetUserId = req.query.userId ? String(req.query.userId) : currentUserId;

    const user = await resolveUser(targetUserId);
    if (!user) {
      return sendResponse(res, 404, false, "User not found");
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const followerIds = user.followers || [];
    const total = followerIds.length;
    const paginatedIds = followerIds.slice().reverse().slice(skip, skip + limit);

    const followers = await User.find({ _id: { $in: paginatedIds } })
      .select("userId name image avatar gender age level wealthLevel charmLevel isOnline isVerified svipLevel bio")
      .lean();

    return sendResponse(res, 200, true, "Followers fetched successfully", {
      users: followers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || "Failed to fetch followers");
  }
};

/**
 * GET /api/user/following
 * Returns paginated users that the user is following
 */
export const getFollowing = async (req: AuthRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id || (req.user as any)?._id;
    const targetUserId = req.query.userId ? String(req.query.userId) : currentUserId;

    const user = await resolveUser(targetUserId);
    if (!user) {
      return sendResponse(res, 404, false, "User not found");
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const followingIds = user.following || [];
    const total = followingIds.length;
    const paginatedIds = followingIds.slice().reverse().slice(skip, skip + limit);

    const followingUsers = await User.find({ _id: { $in: paginatedIds } })
      .select("userId name image avatar gender age level wealthLevel charmLevel isOnline isVerified svipLevel bio")
      .lean();

    return sendResponse(res, 200, true, "Following list fetched successfully", {
      users: followingUsers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || "Failed to fetch following list");
  }
};

/**
 * POST /api/user/visit/:id
 * Records a profile visit by the current user
 */
export const recordProfileVisit = async (req: AuthRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id || (req.user as any)?._id;
    const { id: targetIdentifier } = req.params;

    if (!currentUserId || !targetIdentifier) {
      return sendResponse(res, 400, false, "User identifiers required");
    }

    const targetUser = await resolveUser(targetIdentifier);
    if (!targetUser) {
      return sendResponse(res, 404, false, "Target user not found");
    }

    // Do not record self visits
    if (String(currentUserId) === String(targetUser._id)) {
      return sendResponse(res, 200, true, "Self visit ignored", { self: true });
    }

    const now = new Date();
    await ProfileVisitor.findOneAndUpdate(
      { profileUserId: targetUser._id, visitorId: currentUserId },
      {
        $inc: { visitCount: 1 },
        $set: { lastVisitedAt: now },
        $setOnInsert: { firstVisitedAt: now },
      },
      { upsert: true, new: true }
    );

    await User.findByIdAndUpdate(targetUser._id, {
      $inc: { visitorsCount: 1 },
    });

    return sendResponse(res, 200, true, "Profile visit recorded");
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || "Failed to record profile visit");
  }
};

/**
 * GET /api/user/visitors
 * Returns visitor history matching exact UI requirements:
 * - If user has SVIP (isSvip or svipLevel > 0): returns full visitor list.
 * - If user is not SVIP: limits results to top 5 visitors and sets canViewAll: false.
 */
export const getProfileVisitors = async (req: AuthRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id || (req.user as any)?._id;
    if (!currentUserId) {
      return sendResponse(res, 401, false, "Unauthorized");
    }

    const currentUser = await User.findById(currentUserId).select("isSvip svipLevel");
    const reqUserAny = req.user as any;
    const isSvip = Boolean(
      currentUser?.isSvip ||
      (currentUser?.svipLevel && currentUser.svipLevel > 0) ||
      reqUserAny?.isSvip ||
      (reqUserAny?.svipLevel && reqUserAny.svipLevel > 0)
    );

    const totalVisitors = await ProfileVisitor.countDocuments({ profileUserId: currentUserId });

    // Non-SVIP users are strictly capped at 5 visitors as per specification
    const limit = isSvip ? Math.min(parseInt(req.query.limit as string) || 50, 100) : 5;

    const visitorDocs = await ProfileVisitor.find({ profileUserId: currentUserId })
      .sort({ lastVisitedAt: -1 })
      .limit(limit)
      .populate("visitorId", "userId name image avatar gender age level wealthLevel charmLevel isOnline isVerified svipLevel bio")
      .lean();

    const visitors = visitorDocs
      .filter((doc) => doc.visitorId)
      .map((doc: any) => ({
        _id: String(doc._id),
        visitor: doc.visitorId,
        visitCount: doc.visitCount || 1,
        lastVisitedAt: doc.lastVisitedAt || doc.updatedAt || doc.createdAt,
      }));

    return sendResponse(res, 200, true, "Visitors fetched successfully", {
      visitors,
      totalVisitors,
      canViewAll: isSvip,
      limit,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || "Failed to fetch profile visitors");
  }
};
