import { Request, Response } from 'express';
import mongoose from 'mongoose';
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
        const rooms = await Room.find({ $or: [{ isActive: true }, { isPinned: true }] })
            .populate('ownerId', 'name userId image level country')
            .sort({ isPinned: -1, pinnedOrder: 1, createdAt: -1 })
            .lean();

        const normalized = rooms.map((room: any) => {
            const duration = Math.floor((Date.now() - new Date(room.createdAt).getTime()) / 1000);
            return {
                id: String(room._id),
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
                isPinned: Boolean(room.isPinned),
                pinnedOrder: Number(room.pinnedOrder || 0),
                pinnedAt: room.pinnedAt,
                isActive: Boolean(room.isActive),
                createdAt: room.createdAt
            };
        });

        return sendResponse(res, 200, true, 'Active rooms retrieved successfully', normalized);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Pin / Unpin Voice Room from Admin Panel
 * Rule: Room must be active to be pinned ("lekin room pin tabhi ho payega jab koe room active hoga")
 */
export const togglePinRoomAdmin = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { isPinned, pinnedOrder } = req.body;

        const room = await Room.findOne({
            $or: [
                ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
                { channelName: id }
            ]
        });
        if (!room) {
            return sendResponse(res, 404, false, 'Room not found');
        }

        // Must be active to pin
        if (isPinned && !room.isActive) {
            return sendResponse(res, 400, false, 'Only active voice rooms can be pinned. Room must be live.');
        }

        room.isPinned = Boolean(isPinned);
        if (pinnedOrder !== undefined) {
            room.pinnedOrder = Number(pinnedOrder) || 1;
        } else if (room.isPinned && !room.pinnedOrder) {
            const countPinned = await Room.countDocuments({ isPinned: true });
            room.pinnedOrder = countPinned + 1;
        }

        if (room.isPinned) {
            room.pinnedAt = new Date();
        }

        await room.save();

        if (req.user?.id) {
            await AuditLog.create({
                adminId: req.user.id,
                action: room.isPinned ? 'PIN_ROOM' : 'UNPIN_ROOM',
                target: String(room._id),
                details: `${room.isPinned ? 'Pinned' : 'Unpinned'} room '${room.title}' (Priority: ${room.pinnedOrder})`,
                ipAddress: req.ip || '127.0.0.1',
            });
        }

        return sendResponse(res, 200, true, `Room '${room.title}' ${room.isPinned ? 'pinned' : 'unpinned'} successfully`, {
            id: room._id,
            isPinned: room.isPinned,
            pinnedOrder: room.pinnedOrder,
        });
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Bulk re-order pinned rooms
 */
export const updatePinnedOrderAdmin = async (req: AuthRequest, res: Response) => {
    try {
        const { rooms } = req.body; // array of { id, pinnedOrder }
        if (Array.isArray(rooms)) {
            for (const item of rooms) {
                if (item.id && item.pinnedOrder !== undefined) {
                    await Room.findByIdAndUpdate(item.id, { pinnedOrder: Number(item.pinnedOrder) });
                }
            }
        }
        return sendResponse(res, 200, true, 'Pinned rooms order updated successfully');
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
        const { reason } = req.body;

        if (!reason || String(reason).trim().length < 5) {
            return sendResponse(res, 400, false, 'A descriptive reason (minimum 5 characters) is mandatory for emergency room closure');
        }

        const room = await Room.findById(id);
        if (!room) {
            return sendResponse(res, 404, false, 'Room not found');
        }

        const previousState = { isActive: room.isActive, channelName: room.channelName };
        room.isActive = false;
        room.isPinned = false; // Unpin if terminated
        await room.save();

        // Broadcast room closure via Socket.io to both channel and roomId rooms
        try {
            const io = getIO();
            if (io) {
                const payload = {
                    roomId: String(room._id),
                    channelName: room.channelName,
                    reason: String(reason).trim()
                };
                io.to(room.channelName).emit('room_force_closed', payload);
                io.to(`room_${room._id}`).emit('room_force_closed', payload);
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
