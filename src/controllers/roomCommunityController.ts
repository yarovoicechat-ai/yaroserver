import { Response } from 'express';
import { RoomContributionService } from '../services/roomContribution.service';
import { FanClubService } from '../services/fanClub.service';

export const getRoomContributors = async (req: any, res: Response) => {
  try {
    const roomId = req.params.id;
    const period = (String(req.query.period || 'daily').toLowerCase()) as
      | 'daily'
      | 'weekly'
      | 'monthly';
    const userId = req.user?.id || req.user?._id;

    if (!roomId) {
      return res.status(400).json({ success: false, message: 'Room ID is required' });
    }

    const data = await RoomContributionService.getRoomContributors(
      roomId,
      userId ? String(userId) : undefined,
      period
    );

    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('[getRoomContributors] Error:', error);
    return res
      .status(500)
      .json({ success: false, message: error.message || 'Internal server error' });
  }
};

export const getFanClubDetails = async (req: any, res: Response) => {
  try {
    const roomId = req.params.id;
    const userId = req.user?.id || req.user?._id;

    if (!roomId) {
      return res.status(400).json({ success: false, message: 'Room ID is required' });
    }

    const data = await FanClubService.getFanClubInfo(
      roomId,
      userId ? String(userId) : undefined
    );

    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('[getFanClubDetails] Error:', error);
    return res
      .status(500)
      .json({ success: false, message: error.message || 'Internal server error' });
  }
};

export const joinRoomFanClub = async (req: any, res: Response) => {
  try {
    const roomId = req.params.id;
    const userId = req.user?.id || req.user?._id;
    const plan = (req.body?.plan || '1_month') as '1_month' | '3_months';

    if (!roomId) {
      return res.status(400).json({ success: false, message: 'Room ID is required' });
    }
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const result = await FanClubService.joinFanClub(roomId, String(userId), plan);
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('[joinRoomFanClub] Error:', error);
    return res.status(error.code === 'INSUFFICIENT_DIAMONDS' ? 400 : 500).json({
      success: false,
      code: error.code,
      message: error.message || 'Failed to join Fan Club',
    });
  }
};

export const recordFanClubStayHeartbeat = async (req: any, res: Response) => {
  try {
    const roomId = req.params.id;
    const userId = req.user?.id || req.user?._id;
    const minutes = Number(req.body?.minutes) || 1;

    if (!roomId || !userId) {
      return res.status(400).json({ success: false, message: 'Room ID and User ID are required' });
    }

    await FanClubService.recordStay(roomId, String(userId), minutes);
    return res.status(200).json({ success: true, message: 'Stay recorded' });
  } catch (error: any) {
    console.error('[recordFanClubStayHeartbeat] Error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};
