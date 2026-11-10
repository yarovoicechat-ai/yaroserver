import { Request, Response } from 'express';
import SystemConfig from '../models/systemConfig.model';
import sendResponse from '../utils/reponse';

export const getAppConfig = async (_req: Request, res: Response) => {
  try {
    let config: any = await SystemConfig.findOne({ key: 'global_config' }).lean();
    if (!config) {
      config = await SystemConfig.create({
        key: 'global_config',
        isFamilyEnabled: false,
        isCpEnabled: false,
        isInviteEarnEnabled: false,
      });
    }
    return sendResponse(res, 200, true, 'App configuration retrieved', config);
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch app configuration');
  }
};

export const getPublicAppConfig = async (_req: Request, res: Response) => {
  try {
    const config = await SystemConfig.findOne({ key: 'global_config' }).lean();
    return sendResponse(res, 200, true, 'App configuration retrieved', {
      isFamilyEnabled: config?.isFamilyEnabled ?? false,
      isCpEnabled: config?.isCpEnabled ?? false,
      isInviteEarnEnabled: config?.isInviteEarnEnabled ?? false,
      maintenanceMode: config?.maintenanceMode ?? false,
      storeCategories: config?.storeCategories || [],
    });
  } catch (err: any) { return sendResponse(res, 500, false, 'Failed to fetch app configuration'); }
};

export const updateAppConfig = async (req: Request, res: Response) => {
  try {
    const { isFamilyEnabled, isCpEnabled, isInviteEarnEnabled, maintenanceMode, metadata, feature, enabled } = req.body;
    const update: any = {};
    if (feature === 'family') update.isFamilyEnabled = Boolean(enabled);
    if (feature === 'cp') update.isCpEnabled = Boolean(enabled);
    if (feature === 'inviteEarn' || feature === 'invite' || feature === 'isInviteEarnEnabled') {
      update.isInviteEarnEnabled = Boolean(enabled);
    }
    if (isFamilyEnabled !== undefined) update.isFamilyEnabled = Boolean(isFamilyEnabled);
    if (isCpEnabled !== undefined) update.isCpEnabled = Boolean(isCpEnabled);
    if (isInviteEarnEnabled !== undefined) update.isInviteEarnEnabled = Boolean(isInviteEarnEnabled);
    if (maintenanceMode !== undefined) update.maintenanceMode = Boolean(maintenanceMode);
    if (metadata !== undefined) update.metadata = metadata;

    const config = await SystemConfig.findOneAndUpdate(
      { key: 'global_config' },
      { $set: update },
      { upsert: true, new: true }
    );

    return sendResponse(res, 200, true, 'App configuration updated successfully', config);
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to update app configuration');
  }
};
