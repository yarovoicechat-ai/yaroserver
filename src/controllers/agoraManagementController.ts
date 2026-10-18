import { Request, Response, NextFunction } from 'express';
import { AgoraProjectService } from '../services/agora/agoraProject.service';
import { AgoraTokenService } from '../services/agora/agoraToken.service';
import { AgoraUsageService } from '../services/agora/agoraUsage.service';
import { AgoraFailoverService } from '../services/agora/agoraFailover.service';
import { AgoraProviderSyncService } from '../services/agora/agoraProviderSync.service';
import { ActiveAgoraConfiguration } from '../models/agoraConfig.model';
import { AgoraSwitchHistory, AgoraConfigurationAuditLog } from '../models/agoraAudit.model';
import sendResponse from '../utils/reponse';
import AppError from '../utils/errorHandler';

const getActor = (req: Request) => {
  const user = (req as any).user;
  return {
    id: user?._id || user?.id || null,
    name: user?.name || user?.username || 'Admin',
    role: user?.role || 'admin',
    ip: req.ip || (req.headers['x-forwarded-for'] as string) || '',
  };
};

export const listProjects = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projects = await AgoraProjectService.listProjects();
    const activeConfig = await AgoraProjectService.ensureActiveConfiguration();
    return sendResponse(res, 200, true, 'Agora projects retrieved successfully', {
      projects,
      activeConfig,
    });
  } catch (err: any) {
    next(new AppError(err.message, 500));
  }
};

export const createProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const project = await AgoraProjectService.createProject(req.body, actor);
    return sendResponse(res, 201, true, 'Agora project created and validated successfully', project);
  } catch (err: any) {
    return sendResponse(res, 400, false, err.message);
  }
};

export const updateProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const actor = getActor(req);
    const updated = await AgoraProjectService.updateProject(id, req.body, actor);
    return sendResponse(res, 200, true, 'Agora project updated successfully', updated);
  } catch (err: any) {
    return sendResponse(res, 400, false, err.message);
  }
};

export const deleteProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const actor = getActor(req);
    await AgoraProjectService.deleteProject(id, actor);
    return sendResponse(res, 200, true, 'Agora project deleted successfully');
  } catch (err: any) {
    return sendResponse(res, 400, false, err.message);
  }
};

export const testProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const actor = getActor(req);
    const result = await AgoraProjectService.testProject(id, actor);
    return sendResponse(res, 200, result.success, result.message, result);
  } catch (err: any) {
    return sendResponse(res, 400, false, err.message);
  }
};

export const activateProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const actor = getActor(req);
    const result = await AgoraProjectService.activateProject(id, reason || 'Manual activation via dashboard', actor);
    return sendResponse(res, 200, true, 'Agora project activated as primary', result);
  } catch (err: any) {
    return sendResponse(res, 400, false, err.message);
  }
};

export const disableProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const actor = getActor(req);
    const project = await AgoraProjectService.toggleEnableProject(id, false, actor);
    return sendResponse(res, 200, true, 'Agora project disabled', project);
  } catch (err: any) {
    return sendResponse(res, 400, false, err.message);
  }
};

export const enableProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const actor = getActor(req);
    const project = await AgoraProjectService.toggleEnableProject(id, true, actor);
    return sendResponse(res, 200, true, 'Agora project enabled', project);
  } catch (err: any) {
    return sendResponse(res, 400, false, err.message);
  }
};

export const rollbackProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reason } = req.body;
    const actor = getActor(req);
    const result = await AgoraProjectService.rollback(reason || 'Manual rollback via dashboard', actor);
    return sendResponse(res, 200, true, 'Successfully rolled back to previous Agora project', result);
  } catch (err: any) {
    return sendResponse(res, 400, false, err.message);
  }
};

export const getUsageOverview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const month = (req.query.month as string) || undefined;
    const usage = await AgoraUsageService.getUsageOverview(month);
    return sendResponse(res, 200, true, 'Usage overview fetched successfully', usage);
  } catch (err: any) {
    next(new AppError(err.message, 500));
  }
};

export const getUsageHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const history = await AgoraUsageService.getUsageHistory();
    return sendResponse(res, 200, true, 'Usage history fetched successfully', history);
  } catch (err: any) {
    next(new AppError(err.message, 500));
  }
};

export const syncUsage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await AgoraUsageService.reconcileMonthlyUsage();
    const overview = await AgoraUsageService.getUsageOverview();
    return sendResponse(res, 200, true, 'Usage data reconciled successfully', {
      reconciled: result.reconciledSnapshots,
      overview,
    });
  } catch (err: any) {
    next(new AppError(err.message, 500));
  }
};

export const getProviderSyncStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const month = (req.query.month as string) || undefined;
    const status = await AgoraProviderSyncService.getProviderSyncStatus(month);
    return sendResponse(res, 200, true, 'Provider sync status retrieved', status);
  } catch (err: any) {
    next(new AppError(err.message, 500));
  }
};

export const syncProviderUsage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const month = req.body?.month || (req.query.month as string) || undefined;
    const actor = getActor(req);
    const result = await AgoraProviderSyncService.syncOfficialUsage(month, actor.name, actor.role);
    return sendResponse(res, 200, true, result.message, result);
  } catch (err: any) {
    next(new AppError(err.message, 500));
  }
};

export const getSwitchHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const switches = await AgoraSwitchHistory.find().sort({ createdAt: -1 }).limit(50).lean();
    const auditLogs = await AgoraConfigurationAuditLog.find().sort({ createdAt: -1 }).limit(50).lean();
    return sendResponse(res, 200, true, 'Switch history retrieved', {
      switches,
      auditLogs,
    });
  } catch (err: any) {
    next(new AppError(err.message, 500));
  }
};

export const updateSwitchPolicy = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const updated = await AgoraFailoverService.updateSwitchingPolicy(req.body, actor);
    return sendResponse(res, 200, true, 'Switching policy updated successfully', updated);
  } catch (err: any) {
    return sendResponse(res, 400, false, err.message);
  }
};

export const getClientAgoraConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { project, configVersion } = await AgoraTokenService.resolveProject();
    return res.status(200).json({
      success: true,
      data: {
        appId: project.appId,
        projectId: String(project._id),
        environment: project.environment,
        configVersion,
        service: 'agora_rtc',
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || 'Config error' });
  }
};
