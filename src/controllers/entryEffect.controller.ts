import { Request, Response } from 'express';
import { EntryEffectService } from '../services/entryEffect.service';

export class EntryEffectController {
  static async getEntryEffects(req: Request, res: Response) {
    try {
      const userId = (req as any).user?._id || (req as any).user?.userId || (req as any).user?.id;
      const effects = await EntryEffectService.getEntryEffects(userId);
      return res.status(200).json({ success: true, data: effects });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  static async purchaseEffect(req: Request, res: Response) {
    try {
      const userId = (req as any).user?._id || (req as any).user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const { effectId } = req.body;
      const result = await EntryEffectService.purchaseEffect(userId, effectId);
      return res.status(200).json(result);
    } catch (err: any) {
      const status = err.code === 'INSUFFICIENT_DIAMONDS' ? 400 : 500;
      return res.status(status).json({
        success: false,
        message: err.message,
        code: err.code,
        requiredDiamonds: err.requiredDiamonds,
        availableDiamonds: err.availableDiamonds,
      });
    }
  }

  static async equipEffect(req: Request, res: Response) {
    try {
      const userId = (req as any).user?._id || (req as any).user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const { effectId } = req.body;
      const result = await EntryEffectService.equipEffect(userId, effectId);
      return res.status(200).json(result);
    } catch (err: any) {
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  static async broadcastEntry(req: Request, res: Response) {
    try {
      const user = (req as any).user;
      const { roomId } = req.body;
      if (!roomId) {
        return res.status(400).json({ success: false, message: 'roomId is required' });
      }
      const result = await EntryEffectService.broadcastEntry(roomId, user);
      return res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  static async getAllAdminEffects(req: Request, res: Response) {
    try {
      const effects = await EntryEffectService.getAllAdminEffects();
      return res.status(200).json({ success: true, data: effects });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  static async createEffect(req: Request, res: Response) {
    try {
      const effect = await EntryEffectService.createEffect(req.body);
      return res.status(201).json({ success: true, message: 'Entry effect created successfully', data: effect });
    } catch (err: any) {
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  static async updateEffect(req: Request, res: Response) {
    try {
      const effect = await EntryEffectService.updateEffect(req.params.id, req.body);
      return res.status(200).json({ success: true, message: 'Entry effect updated successfully', data: effect });
    } catch (err: any) {
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  static async deleteEffect(req: Request, res: Response) {
    try {
      await EntryEffectService.deleteEffect(req.params.id);
      return res.status(200).json({ success: true, message: 'Entry effect deleted successfully' });
    } catch (err: any) {
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  static async toggleEffect(req: Request, res: Response) {
    try {
      const effect = await EntryEffectService.toggleEffect(req.params.id);
      return res.status(200).json({ success: true, message: 'Entry effect status updated', data: effect });
    } catch (err: any) {
      return res.status(400).json({ success: false, message: err.message });
    }
  }
}
