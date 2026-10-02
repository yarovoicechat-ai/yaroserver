import { Request, Response } from 'express';
import { VipId } from '../models/vipId.model';
import { SvipTier } from '../models/svipTier.model';
import { User } from '../models/user.model';
import { VipService } from '../services/vip.service';
import sendResponse from '../utils/reponse';

export const getVipCatalog = async (_req: Request, res: Response) => {
  try {
    await VipService.seedInitialCatalog();
    const packages = await VipId.find({ isActive: true }).sort({ sortOrder: 1, vipLevel: 1 }).lean();
    return sendResponse(res, 200, true, 'VIP catalog fetched successfully', { packages });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to fetch VIP catalog');
  }
};

export const getSvipCatalog = async (_req: Request, res: Response) => {
  try {
    await VipService.seedInitialCatalog();
    const tiers = await SvipTier.find({ isActive: true }).sort({ sortOrder: 1, level: 1 }).lean();
    return sendResponse(res, 200, true, 'SVIP catalog fetched successfully', { tiers });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to fetch SVIP catalog');
  }
};

export const buyVip = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    const { vipId, requestId } = req.body;

    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');
    if (!vipId) return sendResponse(res, 400, false, 'VIP ID or Slug is required');

    const result = await VipService.buyVipId(userId, vipId, requestId);
    return sendResponse(res, 200, true, result.message, result);
  } catch (error: any) {
    return sendResponse(res, 400, false, error.message || 'Failed to purchase VIP');
  }
};

export const buySvip = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    const { svipId, requestId } = req.body;

    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');
    if (!svipId) return sendResponse(res, 400, false, 'SVIP ID or Slug is required');

    const result = await VipService.buySvipTier(userId, svipId, requestId);
    return sendResponse(res, 200, true, result.message, result);
  } catch (error: any) {
    return sendResponse(res, 400, false, error.message || 'Failed to purchase SVIP');
  }
};

export const equipVip = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    const { vipSlug } = req.body;

    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');
    if (!vipSlug) return sendResponse(res, 400, false, 'VIP Slug is required');

    const result = await VipService.equipVipId(userId, vipSlug);
    return sendResponse(res, 200, true, 'VIP package equipped successfully', result);
  } catch (error: any) {
    return sendResponse(res, 400, false, error.message || 'Failed to equip VIP');
  }
};

export const unequipVip = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');

    await VipService.unequipVipId(userId);
    return sendResponse(res, 200, true, 'VIP package unequipped');
  } catch (error: any) {
    return sendResponse(res, 400, false, error.message || 'Failed to unequip VIP');
  }
};

export const equipSvip = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    const { svipSlug } = req.body;

    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');
    if (!svipSlug) return sendResponse(res, 400, false, 'SVIP Slug is required');

    const result = await VipService.equipSvipTier(userId, svipSlug);
    return sendResponse(res, 200, true, 'SVIP tier equipped successfully', result);
  } catch (error: any) {
    return sendResponse(res, 400, false, error.message || 'Failed to equip SVIP');
  }
};

export const unequipSvip = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');

    await VipService.unequipSvipTier(userId);
    return sendResponse(res, 200, true, 'SVIP tier unequipped');
  } catch (error: any) {
    return sendResponse(res, 400, false, error.message || 'Failed to unequip SVIP');
  }
};

export const getMyVipExperience = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');

    const user = await User.findById(userId).lean();
    if (!user) return sendResponse(res, 404, false, 'User not found');

    const experience = await VipService.resolveVipExperience(user);
    return sendResponse(res, 200, true, 'VIP experience resolved', { experience, user });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to resolve VIP experience');
  }
};

// Admin Endpoints
export const createVipPackage = async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.name || !data.slug || data.price === undefined) {
      return sendResponse(res, 400, false, 'Name, slug, and price are required');
    }
    const created = await VipId.create(data);
    return sendResponse(res, 201, true, 'VIP package created successfully', created);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to create VIP package');
  }
};

export const updateVipPackage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updated = await VipId.findByIdAndUpdate(id, req.body, { new: true });
    if (!updated) return sendResponse(res, 404, false, 'VIP package not found');
    return sendResponse(res, 200, true, 'VIP package updated', updated);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to update VIP package');
  }
};

export const deleteVipPackage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await VipId.findByIdAndDelete(id);
    if (!deleted) return sendResponse(res, 404, false, 'VIP package not found');
    return sendResponse(res, 200, true, 'VIP package deleted', { id });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to delete VIP package');
  }
};

export const createSvipTier = async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.name || !data.slug || data.level === undefined || data.price === undefined) {
      return sendResponse(res, 400, false, 'Name, slug, level, and price are required');
    }
    const created = await SvipTier.create(data);
    return sendResponse(res, 201, true, 'SVIP tier created successfully', created);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to create SVIP tier');
  }
};

export const updateSvipTier = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updated = await SvipTier.findByIdAndUpdate(id, req.body, { new: true });
    if (!updated) return sendResponse(res, 404, false, 'SVIP tier not found');
    return sendResponse(res, 200, true, 'SVIP tier updated', updated);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to update SVIP tier');
  }
};

export const deleteSvipTier = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await SvipTier.findByIdAndDelete(id);
    if (!deleted) return sendResponse(res, 404, false, 'SVIP tier not found');
    return sendResponse(res, 200, true, 'SVIP tier deleted', { id });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to delete SVIP tier');
  }
};
