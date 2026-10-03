import { Request, Response } from 'express';
import SystemConfig from '../models/systemConfig.model';
import sendResponse from '../utils/reponse';

export const getAppConfig = async (_req: Request, res: Response) => {
  try {
    let config: any = await SystemConfig.findOne({ key: 'global_config' }).lean();
    if (!config) {
      config = await SystemConfig.create({
        key: 'global_config',
        isFamilyEnabled: true,
        isCpEnabled: true,
      });
    }
    return sendResponse(res, 200, true, 'App configuration retrieved', config);
  } catch (err: any) {
    return sendResponse(res, 500, false, err.message || 'Failed to fetch app configuration');
  }
};

export const updateAppConfig = async (req: Request, res: Response) => {
  try {
    const { isFamilyEnabled, isCpEnabled, maintenanceMode, metadata } = req.body;
    const update: any = {};
    if (isFamilyEnabled !== undefined) update.isFamilyEnabled = Boolean(isFamilyEnabled);
    if (isCpEnabled !== undefined) update.isCpEnabled = Boolean(isCpEnabled);
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
