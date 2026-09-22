import { Request, Response } from 'express';
import { CoinsTransaction } from '../models/spentCoinModel';
import { CallQuality } from '../models/callQuality.model';
import { AuditLog } from '../models/auditLog.model';
import { CallStatus } from '../constants/user';
import { getIO, getUserRoom } from '../sockets';
import sendResponse from '../utils/reponse';
import { AuthRequest } from '../middlewares/authorize.middleware';

/**
 * Ingest client or webhook Agora RTC telemetry
 */
export const recordCallTelemetry = async (req: Request, res: Response) => {
    try {
        const {
            callId,
            channelName,
            userId,
            role = 'caller',
            bitrate,
            packetLossRate,
            audioQuality = 'GOOD',
            networkState = 'ONLINE',
            disconnectReason
        } = req.body;

        if (!callId || !channelName || !userId) {
            return sendResponse(res, 400, false, 'callId, channelName, and userId are required');
        }

        const entry = await CallQuality.create({
            callId,
            channelName,
            userId,
            role,
            bitrate: bitrate !== undefined ? Number(bitrate) : undefined,
            packetLossRate: packetLossRate !== undefined ? Number(packetLossRate) : undefined,
            audioQuality,
            networkState,
            disconnectReason,
            recordedAt: new Date()
        });

        return sendResponse(res, 201, true, 'Telemetry recorded', entry);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Get active voice & video calls enriched with latest telemetry
 */
export const getActiveCallsWithTelemetry = async (req: AuthRequest, res: Response) => {
    try {
        const activeStatuses = [
            CallStatus.ACCEPTED,
            CallStatus.CONNECTING,
            CallStatus.CONNECTED,
            CallStatus.RINGING
        ];

        const calls = await CoinsTransaction.find({ status: { $in: activeStatuses } })
            .populate('userId', 'name userId image country level gender')
            .populate('hostId', 'name userId image country level gender')
            .sort({ callStart: -1, createdAt: -1 })
            .lean();

        // Enrich with real telemetry if available
        const enriched = await Promise.all(calls.map(async (call: any) => {
            const latestTelemetry = await CallQuality.findOne({ callId: call._id })
                .sort({ recordedAt: -1 })
                .lean();

            const startTime = call.callStart || call.createdAt;
            const liveDuration = startTime ? Math.floor((Date.now() - new Date(startTime).getTime()) / 1000) : 0;

            return {
                id: call._id,
                channelName: call.channelName || 'PENDING_INIT',
                callType: call.type || 'VOICE_CALL',
                caller: {
                    id: call.userId?._id,
                    name: call.userId?.name || 'Caller',
                    userId: call.userId?.userId,
                    image: call.userId?.image,
                    country: call.userId?.country?.code || 'IN'
                },
                receiver: {
                    id: call.hostId?._id,
                    name: call.hostId?.name || 'Host',
                    userId: call.hostId?.userId,
                    image: call.hostId?.image,
                    country: call.hostId?.country?.code || 'IN'
                },
                start: startTime,
                duration: liveDuration,
                status: call.status,
                telemetry: latestTelemetry ? {
                    bitrate: latestTelemetry.bitrate || 64,
                    packetLossRate: latestTelemetry.packetLossRate || 0,
                    audioQuality: latestTelemetry.audioQuality || 'GOOD',
                    networkState: latestTelemetry.networkState || 'ONLINE'
                } : null // Safety Rule: Do not fake telemetry when not reported
            };
        }));

        return sendResponse(res, 200, true, 'Active calls retrieved successfully', enriched);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Force terminate active call by Admin
 */
export const forceTerminateCall = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { reason = 'Call terminated by Administrator' } = req.body;

        const call = await CoinsTransaction.findById(id);
        if (!call) {
            return sendResponse(res, 404, false, 'Call transaction not found');
        }

        const now = new Date();
        const duration = call.callStart ? Math.floor((now.getTime() - call.callStart.getTime()) / 1000) : 0;

        call.status = CallStatus.ENDED;
        call.callEnd = now;
        call.duration = duration;
        if (!call.meta) call.meta = {};
        (call.meta as any).disconnectReason = reason;
        await call.save();

        // Disconnect Agora session via Socket.io notification
        try {
            const io = getIO();
            if (io) {
                if (call.userId) {
                    io.to(getUserRoom(String(call.userId))).emit('call_ended', {
                        callId: String(call._id),
                        reason
                    });
                }
                if (call.hostId) {
                    io.to(getUserRoom(String(call.hostId))).emit('call_ended', {
                        callId: String(call._id),
                        reason
                    });
                }
            }
        } catch (socketErr) {
            console.warn('Socket notification error on force call drop:', socketErr);
        }

        // Audit Trail
        if (req.user?.id) {
            await AuditLog.create({
                adminId: req.user.id,
                action: 'FORCE_TERMINATE_CALL',
                target: String(call._id),
                details: `Terminated call in channel '${call.channelName}'. Duration: ${duration}s. Reason: ${reason}`,
                ipAddress: req.ip || '127.0.0.1',
                userAgent: req.headers['user-agent'],
                oldValue: { status: call.status, channel: call.channelName },
                newValue: { status: 'ENDED', duration },
                reason
            });
        }

        return sendResponse(res, 200, true, 'Call terminated successfully', {
            callId: call._id,
            duration,
            status: CallStatus.ENDED
        });
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Get call diagnostics history
 */
export const getCallDiagnostics = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const call = await CoinsTransaction.findById(id)
            .populate('userId', 'name userId image')
            .populate('hostId', 'name userId image');

        if (!call) {
            return sendResponse(res, 404, false, 'Call record not found');
        }

        const telemetryLogs = await CallQuality.find({ callId: id })
            .sort({ recordedAt: 1 })
            .limit(100);

        return sendResponse(res, 200, true, 'Call diagnostics retrieved', {
            call,
            telemetry: telemetryLogs
        });
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};
