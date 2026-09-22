import { Request, Response } from 'express';
import { Room } from '../models/room.model';
import { AuditLog } from '../models/auditLog.model';
import { getIO } from '../sockets';
import sendResponse from '../utils/reponse';
import { AuthRequest } from '../middlewares/authorize.middleware';

/**
 * Get active voice rooms for administrative surveillance
 */
export const getActiveRoomsAdmin = async (req: AuthRequest, res: Response) => {
    try {
        const rooms = await Room.find({ isActive: true })
            .populate('ownerId', 'name userId image level country')
            .sort({ createdAt: -1 })
            .lean();

        const normalized = rooms.map((room: any) => {
            const duration = Math.floor((Date.now() - new Date(room.createdAt).getTime()) / 1000);
            return {
                id: room._id,
                channelName: room.channelName,
                title: room.title,
                category: room.category || 'General',
                isLocked: room.isLocked || false,
                host: {
                    id: room.ownerId?._id,
                    name: room.ownerId?.name || 'Club Host',
                    userId: room.ownerId?.userId,
                    image: room.ownerId?.image,
                    level: room.ownerId?.level || 1,
                    country: room.ownerId?.country?.code || 'IN'
                },
                speakersCount: 1, // Host on mic stage
                audienceCount: Array.isArray(room.members) ? room.members.length : 0,
                duration,
                status: room.isActive ? 'LIVE' : 'ENDED',
                createdAt: room.createdAt
            };
        });

        return sendResponse(res, 200, true, 'Active rooms retrieved successfully', normalized);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Emergency terminate voice room
 */
export const emergencyCloseRoom = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { reason = 'Voice room closed by Administrator' } = req.body;

        const room = await Room.findById(id);
        if (!room) {
            return sendResponse(res, 404, false, 'Room not found');
        }

        const previousState = { isActive: room.isActive, channelName: room.channelName };
        room.isActive = false;
        await room.save();

        // Broadcast room closure via Socket.io
        try {
            const io = getIO();
            if (io) {
                io.to(room.channelName).emit('room_force_closed', {
                    roomId: String(room._id),
                    channelName: room.channelName,
                    reason
                });
            }
        } catch (socketErr) {
            console.warn('Socket broadcast error on room closure:', socketErr);
        }

        // Audit Trail
        if (req.user?.id) {
            await AuditLog.create({
                adminId: req.user.id,
                action: 'EMERGENCY_CLOSE_ROOM',
                target: String(room._id),
                details: `Closed active voice club room '${room.title}' in channel '${room.channelName}'. Reason: ${reason}`,
                ipAddress: req.ip || '127.0.0.1',
                userAgent: req.headers['user-agent'],
                oldValue: previousState,
                newValue: { isActive: false },
                reason
            });
        }

        return sendResponse(res, 200, true, `Room '${room.title}' terminated successfully`, {
            roomId: room._id,
            status: 'ENDED'
        });
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};
