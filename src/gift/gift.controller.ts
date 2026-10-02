import { Response } from 'express';
import { AuthRequest } from '../middlewares/authorize.middleware';
import { GiftService } from './gift.service';
import sendResponse from '../utils/reponse';

export class GiftController {
  /**
   * GET /api/gifts
   * Fetch active gifts with optional category, rarity, VIP filtering
   */
  static async getGifts(req: AuthRequest, res: Response) {
    try {
      const gifts = await GiftService.getGifts(req.query);
      return sendResponse(res, 200, true, 'Gifts fetched successfully', gifts);
    } catch (error: any) {
      return sendResponse(res, 500, false, error.message);
    }
  }

  /**
   * GET /api/gifts/categories
   * Fetch dynamic categories
   */
  static async getCategories(req: AuthRequest, res: Response) {
    try {
      const categories = await GiftService.getCategories();
      return sendResponse(res, 200, true, 'Gift categories fetched successfully', categories);
    } catch (error: any) {
      return sendResponse(res, 500, false, error.message);
    }
  }

  /**
   * POST /api/gifts/send
   * Idempotent send gift endpoint with atomic Diamonds deduction
   */
  static async sendGift(req: AuthRequest, res: Response) {
    try {
      const senderId = req.user?.id;
      if (!senderId) {
        return sendResponse(res, 401, false, 'Authentication required');
      }

      const result = await GiftService.sendGift(senderId, req.body);
      return sendResponse(res, 200, true, 'Gift sent successfully', result);
    } catch (error: any) {
      if (error.code === 'INSUFFICIENT_DIAMONDS') {
        return sendResponse(
          res,
          400,
          false,
          error.message || 'Insufficient Diamonds balance to send this gift',
          {
            code: 'INSUFFICIENT_DIAMONDS',
            requiredDiamonds: error.requiredDiamonds,
            availableDiamonds: error.availableDiamonds,
          }
        );
      }
      return sendResponse(res, 400, false, error.message || 'Failed to send gift');
    }
  }

  /**
   * GET /api/gifts/history
   * Combined history of sent and received gifts
   */
  static async getHistory(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return sendResponse(res, 401, false, 'Authentication required');
      }
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 20;

      const history = await GiftService.getHistory(userId, 'all', page, limit);
      return sendResponse(res, 200, true, 'Gift history fetched successfully', history);
    } catch (error: any) {
      return sendResponse(res, 500, false, error.message);
    }
  }

  /**
   * GET /api/gifts/sent
   * Gifts sent by user
   */
  static async getSentGifts(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return sendResponse(res, 401, false, 'Authentication required');
      }
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 20;

      const history = await GiftService.getHistory(userId, 'sent', page, limit);
      return sendResponse(res, 200, true, 'Sent gifts history fetched successfully', history);
    } catch (error: any) {
      return sendResponse(res, 500, false, error.message);
    }
  }

  /**
   * GET /api/gifts/received
   * Gifts received by user
   */
  static async getReceivedGifts(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return sendResponse(res, 401, false, 'Authentication required');
      }
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 20;

      const history = await GiftService.getHistory(userId, 'received', page, limit);
      return sendResponse(res, 200, true, 'Received gifts history fetched successfully', history);
    } catch (error: any) {
      return sendResponse(res, 500, false, error.message);
    }
  }

  // ========================
  // Admin Controllers
  // ========================

  static async adminCreateGift(req: AuthRequest, res: Response) {
    try {
      const gift = await GiftService.adminCreateGift(req.body);
      return sendResponse(res, 201, true, 'Gift created successfully', gift);
    } catch (error: any) {
      return sendResponse(res, 400, false, error.message);
    }
  }

  static async adminUpdateGift(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const gift = await GiftService.adminUpdateGift(id, req.body);
      if (!gift) return sendResponse(res, 404, false, 'Gift not found');
      return sendResponse(res, 200, true, 'Gift updated successfully', gift);
    } catch (error: any) {
      return sendResponse(res, 400, false, error.message);
    }
  }

  static async adminDeleteGift(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const gift = await GiftService.adminDeleteGift(id);
      if (!gift) return sendResponse(res, 404, false, 'Gift not found');
      return sendResponse(res, 200, true, 'Gift deleted successfully');
    } catch (error: any) {
      return sendResponse(res, 500, false, error.message);
    }
  }

  static async adminToggleStatus(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      const gift = await GiftService.adminToggleGiftActive(id, Boolean(isActive));
      if (!gift) return sendResponse(res, 404, false, 'Gift not found');
      return sendResponse(
        res,
        200,
        true,
        `Gift ${gift.isActive ? 'activated' : 'deactivated'} successfully`,
        gift
      );
    } catch (error: any) {
      return sendResponse(res, 400, false, error.message);
    }
  }

  static async adminCreateCategory(req: AuthRequest, res: Response) {
    try {
      const cat = await GiftService.adminCreateCategory(req.body);
      return sendResponse(res, 201, true, 'Category created successfully', cat);
    } catch (error: any) {
      return sendResponse(res, 400, false, error.message);
    }
  }

  static async adminUpdateCategory(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const cat = await GiftService.adminUpdateCategory(id, req.body);
      if (!cat) return sendResponse(res, 404, false, 'Category not found');
      return sendResponse(res, 200, true, 'Category updated successfully', cat);
    } catch (error: any) {
      return sendResponse(res, 400, false, error.message);
    }
  }

  static async adminDeleteCategory(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const cat = await GiftService.adminDeleteCategory(id);
      if (!cat) return sendResponse(res, 404, false, 'Category not found');
      return sendResponse(res, 200, true, 'Category deleted successfully');
    } catch (error: any) {
      return sendResponse(res, 500, false, error.message);
    }
  }
}
