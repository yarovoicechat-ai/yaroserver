import { Request, Response } from 'express';
import AvatarRequest, { AvatarRequestStatus } from '../models/avatarRequest.model';
import { User } from '../models/user.model';
import Host from '../models/host.model';
import Notification from '../models/notification.model';
import sendResponse from '../utils/reponse';
import { AuthRequest } from '../middlewares/authorize.middleware';
import { validateAvatarSecurity } from '../utils/avatarSecurity';

// 1. Submit Avatar Update (Normal profile operation - No verification required)
export const submitAvatarRequest = async (req: AuthRequest, res: Response) => {
  try {
    const authUserId = req.user?.userId;
    const authId = req.user?.id;

    if (!authUserId && !authId) {
      return sendResponse(res, 401, false, 'Authentication required to update avatar');
    }

    let rawAvatar: string | undefined;

    // Direct multipart file upload support
    const uploadedFile =
      req.file ||
      (req.files as any)?.file?.[0] ||
      (req.files as any)?.avatar?.[0] ||
      (req.files as any)?.image?.[0] ||
      (req.files as any)?.profilePic?.[0];
    if (uploadedFile) {
      const host = req.get('host') || 'api.yaroapp.in';
      const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      rawAvatar = `${protocol}://${host}/uploads/avatars/${uploadedFile.filename}`;
    } else {
      const { requestedAvatar, avatar, profilePic, image } = req.body || {};
      rawAvatar = requestedAvatar || avatar || profilePic || image;
    }

    if (!rawAvatar) {
      return sendResponse(res, 400, false, 'Avatar image or file is required');
    }

    // Image security check: validate extension, MIME candidate, and prevent executables
    const validation = validateAvatarSecurity(rawAvatar);
    if (!validation.valid || !validation.cleanAvatar) {
      return sendResponse(res, 400, false, validation.error || 'Invalid avatar image');
    }

    const cleanAvatar = validation.cleanAvatar;

    // Find the user to update - strictly using authenticated user credentials
    const userQuery: any = { isDeleted: false };
    if (authUserId) {
      userQuery.userId = authUserId;
    } else {
      userQuery._id = authId;
    }

    const user = await User.findOne(userQuery);
    if (!user) {
      return sendResponse(res, 404, false, 'User account not found');
    }

    // Directly update User avatar (normal profile operation, zero verification required)
    user.image = cleanAvatar;
    await user.save();

    // If user is a host, update host record immediately as well
    await Host.updateOne(
      { hostId: user.userId },
      { $set: { profilePhoto: cleanAvatar } }
    ).catch(() => {});

    // Save approved audit record for admin history
    const newRequest = new AvatarRequest({
      hostId: user.userId,
      hostUserObjId: user._id,
      currentAvatar: cleanAvatar,
      requestedAvatar: cleanAvatar,
      status: AvatarRequestStatus.APPROVED,
      reviewedAt: new Date(),
    });
    await newRequest.save();

    return sendResponse(res, 200, true, 'Avatar updated successfully', {
      avatarUrl: cleanAvatar,
      profilePic: cleanAvatar,
      image: cleanAvatar,
      data: {
        avatarUrl: cleanAvatar,
        profilePic: cleanAvatar,
        image: cleanAvatar,
      },
      user: {
        userId: user.userId,
        name: user.name,
        image: user.image,
        profilePic: user.image,
      }
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error?.message || 'Server error updating avatar');
  }
};

// 2. Get Avatar Audit & Change Requests (Admin Panel)
export const getAvatarRequests = async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const query: any = {};
    if (status) {
      query.status = status;
    }

    const requests = await AvatarRequest.find(query)
      .populate('hostUserObjId', 'name userId email phoneNumber image')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await AvatarRequest.countDocuments(query);

    return sendResponse(res, 200, true, 'Avatar requests fetched successfully', {
      requests,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error?.message || 'Server error fetching avatar requests');
  }
};

// 3. Approve Avatar Request (Admin)
export const approveAvatarRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const adminObjId = req.user?.id;

    const avatarReq = await AvatarRequest.findById(id);
    if (!avatarReq) {
      return sendResponse(res, 404, false, 'Avatar request not found');
    }

    if (avatarReq.status !== AvatarRequestStatus.PENDING) {
      return sendResponse(res, 400, false, `Request already ${avatarReq.status}`);
    }

    avatarReq.status = AvatarRequestStatus.APPROVED;
    avatarReq.reviewedBy = adminObjId as any;
    avatarReq.reviewedAt = new Date();
    await avatarReq.save();

    // Update User image & Host profilePhoto automatically
    await User.updateOne(
      { userId: avatarReq.hostId },
      { $set: { image: avatarReq.requestedAvatar } }
    );

    await Host.updateOne(
      { hostId: avatarReq.hostId },
      { $set: { profilePhoto: avatarReq.requestedAvatar } }
    );

    // Notify Host
    await Notification.create({
      userId: avatarReq.hostUserObjId,
      title: 'Avatar Request Approved 🎉',
      message: 'Your avatar change request has been approved and updated on your profile.',
      type: 'system',
    });

    return sendResponse(res, 200, true, 'Avatar request approved successfully', avatarReq);
  } catch (error: any) {
    return sendResponse(res, 500, false, error?.message || 'Server error approving avatar request');
  }
};

// 4. Reject Avatar Request (Admin)
export const rejectAvatarRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminObjId = req.user?.id;

    const avatarReq = await AvatarRequest.findById(id);
    if (!avatarReq) {
      return sendResponse(res, 404, false, 'Avatar request not found');
    }

    if (avatarReq.status !== AvatarRequestStatus.PENDING) {
      return sendResponse(res, 400, false, `Request already ${avatarReq.status}`);
    }

    avatarReq.status = AvatarRequestStatus.REJECTED;
    avatarReq.rejectReason = reason || 'Avatar image does not meet community guidelines';
    avatarReq.reviewedBy = adminObjId as any;
    avatarReq.reviewedAt = new Date();
    await avatarReq.save();

    // Notify Host
    await Notification.create({
      userId: avatarReq.hostUserObjId,
      title: 'Avatar Request Rejected ❌',
      message: `Your avatar change request was rejected. Reason: ${avatarReq.rejectReason}`,
      type: 'system',
    });

    return sendResponse(res, 200, true, 'Avatar request rejected', avatarReq);
  } catch (error: any) {
    return sendResponse(res, 500, false, error?.message || 'Server error rejecting avatar request');
  }
};
