import { Request, Response } from 'express';
import { EmojiService } from '../services/emoji.service';

export class EmojiController {
  /**
   * GET /api/emojis or /api/v1/emojis
   * Public list of emojis with categories, pngUrl and gifUrl
   */
  static async getEmojis(req: Request, res: Response) {
    try {
      const emojis = await EmojiService.getActiveEmojis();
      const categories = Array.from(new Set(emojis.map((e) => e.category || 'Expressions')));

      return res.status(200).json({
        success: true,
        data: emojis,
        categories: ['All', ...categories],
        total: emojis.length,
      });
    } catch (err: any) {
      console.error('[EmojiController] getEmojis error:', err);
      return res.status(500).json({ success: false, error: err?.message || 'Failed to load emojis' });
    }
  }

  /**
   * GET /api/emojis/admin/all
   */
  static async getAdminEmojis(req: Request, res: Response) {
    try {
      const emojis = await EmojiService.getAllAdminEmojis();
      return res.status(200).json({ success: true, data: emojis });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message });
    }
  }

  /**
   * POST /api/emojis
   */
  static async upsertEmoji(req: Request, res: Response) {
    try {
      const emoji = await EmojiService.upsertEmoji(req.body);
      return res.status(200).json({ success: true, data: emoji });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err?.message });
    }
  }

  /**
   * DELETE /api/emojis/:id
   */
  static async deleteEmoji(req: Request, res: Response) {
    try {
      await EmojiService.deleteEmoji(req.params.id);
      return res.status(200).json({ success: true, message: 'Emoji deleted' });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err?.message });
    }
  }
}

