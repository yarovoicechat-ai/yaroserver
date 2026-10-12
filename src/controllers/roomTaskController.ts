import { Response } from 'express';
import { RoomTaskService } from '../services/roomTask.service';

export const getRoomTasks = async (req: any, res: Response) => {
  try {
    const roomId = req.params.id;
    const userId = req.user?.id || req.user?._id;

    if (!roomId) {
      return res.status(400).json({ success: false, message: 'Room ID is required' });
    }

    const data = await RoomTaskService.getRoomTasks(roomId, String(userId));
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('[getRoomTasks] Error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

export const claimTaskReward = async (req: any, res: Response) => {
  try {
    const roomId = req.params.id;
    const taskId = req.params.taskId;
    const userId = req.user?.id || req.user?._id;

    if (!roomId || !taskId) {
      return res.status(400).json({ success: false, message: 'Room ID and Task ID are required' });
    }

    const data = await RoomTaskService.claimTaskReward(roomId, String(userId), taskId);
    return res.status(200).json({ success: true, message: 'Reward claimed successfully', data });
  } catch (error: any) {
    console.error('[claimTaskReward] Error:', error);
    return res.status(400).json({ success: false, message: error.message || 'Failed to claim reward' });
  }
};

export const recordMicHeartbeat = async (req: any, res: Response) => {
  try {
    const roomId = req.params.id;
    const userId = req.user?.id || req.user?._id;
    const minutes = Number(req.body?.minutes) || 1;

    if (!roomId) {
      return res.status(400).json({ success: false, message: 'Room ID is required' });
    }

    await RoomTaskService.recordMicDuration(roomId, String(userId), minutes);
    return res.status(200).json({ success: true, message: 'Heartbeat recorded' });
  } catch (error: any) {
    console.error('[recordMicHeartbeat] Error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

export const getRoomSupport = async (req: any, res: Response) => {
  try {
    const roomId = req.params.id;
    const userId = req.user?.id || req.user?._id;

    if (!roomId) {
      return res.status(400).json({ success: false, message: 'Room ID is required' });
    }

    const data = await RoomTaskService.getRoomSupportStats(roomId, String(userId));
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('[getRoomSupport] Error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

export const toggleAutoSendSupport = async (req: any, res: Response) => {
  try {
    const roomId = req.params.id;
    const autoSend = Boolean(req.body?.autoSend);

    if (!roomId) {
      return res.status(400).json({ success: false, message: 'Room ID is required' });
    }

    const data = await RoomTaskService.toggleAutoSendRewards(roomId, autoSend);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.error('[toggleAutoSendSupport] Error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};
