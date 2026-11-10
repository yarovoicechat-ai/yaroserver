import { Request, Response } from 'express';
import { VipAssets } from '../models/vipAssets.model';
import { VipAssetsService } from '../services/vipAssets.service';
import sendResponse from '../utils/reponse';

export const listVipAssets = async (_req: Request, res: Response) => {
  try {
    return sendResponse(res, 200, true, 'VIP assets fetched', { levels: await VipAssetsService.list() });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message);
  }
};

export const updateVipAssets = async (req: Request, res: Response) => {
  const level = Number(req.params.level);
  if (!Number.isInteger(level) || level < 1 || level > 5) return sendResponse(res, 400, false, 'VIP level must be 1–5');
  const update: Record<string, any> = { level };
  for (const kind of ['frame', 'entry']) {
    const media = req.body?.[kind];
    const validUrl = (value: unknown, extension: string) => typeof value === 'string' &&
      /^(https?:\/\/|\/api\/|\/uploads\/)/i.test(value) &&
      new RegExp(`\\.${extension}(?:[?#]|$)`, 'i').test(value) && value.length <= 2048;
    if (!media || typeof media.name !== 'string' || !media.name.trim() || media.name.length > 100 ||
        !validUrl(media.imageUrl, 'png') || !validUrl(media.animationUrl, 'svga') || typeof media.isActive !== 'boolean') {
      return sendResponse(res, 400, false, `Valid ${kind} name, PNG preview, SVGA animation and active status are required`);
    }
    update[kind] = {
      id: `vip_${kind}_${level}`, name: media.name.trim(), imageUrl: media.imageUrl,
      animationUrl: media.animationUrl, isActive: media.isActive,
    };
  }
  try {
    const saved = await VipAssets.findOneAndUpdate({ level }, { $set: update }, {
      new: true, upsert: true, runValidators: true,
    }).lean();
    return sendResponse(res, 200, true, 'VIP assets saved', saved);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message);
  }
};
