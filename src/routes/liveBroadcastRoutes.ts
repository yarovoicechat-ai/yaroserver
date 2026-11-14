import { Router } from "express";
import { Types } from "mongoose";
import agoraToken from "agora-token";
import LiveBroadcast from "../models/liveBroadcast.model";
import {
  AuthRequest,
  verifyToken,
  checkPermission,
} from "../middlewares/authorize.middleware";
import { AgoraTokenService } from "../services/agora/agoraToken.service";
import { GiftTransaction } from "../gift/gift.model";
import { User } from '../models/user.model';

const router = Router();
const lease = () => new Date(Date.now() - 90000);
const active = () => ({ status: "live", heartbeatAt: { $gt: lease() } });
const uid = (id: unknown) =>
  (parseInt(String(id).slice(-8), 16) % 4294967294) + 1;
const clean = (room: any) => {
  const { viewers, projectId, ...data } = room.toObject
    ? room.toObject()
    : room;
  return {
    ...data,
    viewerCount: data.status === 'live' ? (viewers || []).filter((v: any) => v.heartbeatAt > lease()).length : 0,
  };
};
const wrap = (handler: any) => async (req: any, res: any, next: any) => {
  try {
    await handler(req, res);
  } catch (error: any) {
    if (error.code === 11000)
      return res
        .status(409)
        .json({
          success: false,
          message: "You already have an active live room.",
        });
    next(error);
  }
};
async function expire() {
  await LiveBroadcast.updateMany(
    { status: "live", heartbeatAt: { $lte: lease() } },
    [{
      $set: {
        status: "ended",
        endedAt: { $add: ['$heartbeatAt', 90000] },
        endReason: "Host disconnected",
      },
    }]
  );
}
async function credentials(room: any, userId: unknown) {
  const { project, certificate } = await AgoraTokenService.resolveProject(
    room.projectId
  );
  // A session must stay on its original project even if the active project changes.
  if (String(project._id) !== room.projectId || !certificate)
    throw new Error("Live video project is unavailable.");
  const isHost = String(room.host?._id || room.host) === String(userId);
  const agoraUid = uid(userId);
  const channelName = `live_${room._id}`;
  const token = agoraToken.RtcTokenBuilder.buildTokenWithUid(
    project.appId,
    certificate,
    channelName,
    agoraUid,
    isHost ? agoraToken.RtcRole.PUBLISHER : agoraToken.RtcRole.SUBSCRIBER,
    3600,
    3600
  );
  return {
    appId: project.appId,
    channelName,
    token,
    agoraUid,
    hostUid: room.hostUid,
    isHost,
  };
}

router.use(verifyToken);
router.get('/admin/trends', checkPermission('Rooms', 'view'), wrap(async (_req: AuthRequest, res: any) => {
  const since = new Date(Date.now() - 7 * 86400000);
  const rows = await LiveBroadcast.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: 'Asia/Kolkata' } },
      sessions: { $sum: 1 }, duration: { $sum: { $max: [0, { $divide: [{ $subtract: [{ $ifNull: ['$endedAt', '$heartbeatAt'] }, '$createdAt'] }, 60000] }] } } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: '$_id', sessions: 1, duration: { $round: ['$duration', 0] } } },
  ]);
  res.json({ success: true, data: rows });
}));
router.get(
  "/history",
  wrap(async (req: AuthRequest, res: any) => {
    await expire();
    const rooms = await LiveBroadcast.find({ host: req.user!.id })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ success: true, data: rooms.map(clean) });
  })
);
router.get(
  "/ranking",
  wrap(async (req: AuthRequest, res: any) => {
    const metric = String(req.query.type || "diamonds");
    const days =
      req.query.range === "monthly" ? 30 : req.query.range === "weekly" ? 7 : 1;
    const since = new Date(Date.now() - days * 86400000);
    const isRoom = metric === "rooms";
    const rows = await (isRoom ? LiveBroadcast : GiftTransaction).aggregate([
      {
        $match: isRoom
          ? { createdAt: { $gte: since } }
          : {
              createdAt: { $gte: since },
              status: { $in: ["SUCCESS", "COMPLETED"] },
            },
      },
      {
        $group: {
          _id: isRoom
            ? "$host"
            : metric === "coins"
            ? "$receiverId"
            : "$senderId",
          score: {
            $sum: isRoom
              ? 1
              : metric === "coins"
              ? { $ifNull: ["$hostEarning", 0] }
              : { $ifNull: ["$totalDiamonds", "$totalPrice"] },
          },
        },
      },
      { $match: { score: { $gt: 0 } } },
      { $sort: { score: -1, _id: 1 } },
      { $limit: 50 },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $match: {
          "user.isDeleted": { $ne: true },
          "user.isBlocked": { $ne: true },
        },
      },
      { $project: { name: "$user.name", image: "$user.image", score: 1 } },
    ]);
    res.json({
      success: true,
      data: rows.map((row: any) => ({
        id: String(row._id),
        name: row.name,
        image: row.image,
        [metric]: row.score,
      })),
    });
  })
);
router.get(
  "/rooms",
  wrap(async (_req: AuthRequest, res: any) => {
    await expire();
    const rooms = await LiveBroadcast.find(active())
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(100)
      .populate("host", "name image userId");
    res.json({ success: true, data: rooms.map(clean) });
  })
);
router.post(
  "/rooms",
  wrap(async (req: AuthRequest, res: any) => {
    const title = String(req.body.title || "").trim();
    const category = String(req.body.category || "Live");
    const coverImage = String(req.body.coverImage || "").trim();
    if (
      !title ||
      title.length > 80 ||
      !["Live", "Beauty", "PK"].includes(category) ||
      (coverImage &&
        (!/^https:\/\//i.test(coverImage) || coverImage.length > 2048))
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Enter a title (1–80 characters), valid category and HTTPS cover image.",
        });
    }
    await expire();
    const { project, certificate } = await AgoraTokenService.resolveProject();
    if (!certificate)
      return res
        .status(503)
        .json({
          success: false,
          message:
            "Configure an Agora certificate in the panel before going live.",
        });
    const room = await LiveBroadcast.create({
      host: req.user!.id,
      title,
      category,
      coverImage,
      projectId: String(project._id),
      hostUid: uid(req.user!.id),
    });
    res
      .status(201)
      .json({
        success: true,
        data: { room: clean(room), rtc: await credentials(room, req.user!.id) },
      });
  })
);

router.get(
  "/admin/rooms",
  checkPermission("Rooms", "view"),
  wrap(async (req: AuthRequest, res: any) => {
    await expire();
    const filter: any = {};
    if (req.query.hostId) {
      const hostId = String(req.query.hostId);
      if (Types.ObjectId.isValid(hostId)) filter.host = hostId;
      else {
        const host = await User.findOne({ userId: Number(hostId) }).select('_id').lean();
        if (!host) return res.json({ success: true, data: [] });
        filter.host = host._id;
      }
    }
    const rooms = await LiveBroadcast.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("host", "name image userId");
    res.json({ success: true, data: rooms.map(clean) });
  })
);
router.post(
  "/admin/rooms/:id/end",
  checkPermission("Rooms", "edit"),
  wrap(async (req: any, res: any) => {
    if (!Types.ObjectId.isValid(req.params.id))
      return res
        .status(400)
        .json({ success: false, message: "Invalid room ID" });
    const room = await LiveBroadcast.findOneAndUpdate(
      { _id: req.params.id, status: "live" },
      {
        $set: {
          status: "ended",
          endedAt: new Date(),
          endReason: "Ended by moderator",
        },
      },
      { new: true }
    );
    res
      .status(room ? 200 : 404)
      .json({
        success: !!room,
        data: room ? clean(room) : undefined,
        message: room ? "Live ended" : "Live room not found",
      });
  })
);
router.post(
  "/admin/rooms/:id/pin",
  checkPermission("Rooms", "edit"),
  wrap(async (req: any, res: any) => {
    if (
      !Types.ObjectId.isValid(req.params.id) ||
      typeof req.body.isPinned !== "boolean"
    )
      return res
        .status(400)
        .json({ success: false, message: "Invalid pin request" });
    const room = await LiveBroadcast.findOneAndUpdate(
      { _id: req.params.id, ...active() },
      { $set: { isPinned: req.body.isPinned } },
      { new: true }
    );
    res
      .status(room ? 200 : 404)
      .json({ success: !!room, data: room ? clean(room) : undefined });
  })
);

router.param("id", (req, res, next, id) => {
  if (!Types.ObjectId.isValid(id))
    return res.status(400).json({ success: false, message: "Invalid room ID" });
  next();
});
router.post(
  "/rooms/:id/join",
  wrap(async (req: any, res: any) => {
    const room = await LiveBroadcast.findOne({
      _id: req.params.id,
      ...active(),
    }).populate("host", "name image userId");
    if (!room)
      return res
        .status(404)
        .json({ success: false, message: "This live has ended." });
    res.json({
      success: true,
      data: { room: clean(room), rtc: await credentials(room, req.user.id) },
    });
  })
);
router.post(
  "/rooms/:id/heartbeat",
  wrap(async (req: any, res: any) => {
    const room = await LiveBroadcast.findOne({
      _id: req.params.id,
      ...active(),
    });
    if (!room)
      return res
        .status(410)
        .json({ success: false, message: "This live has ended." });
    if (String(room.host) === String(req.user.id)) {
      await LiveBroadcast.updateOne(
        { _id: room._id, ...active() },
        { $set: { heartbeatAt: new Date() } }
      );
    } else {
      // One lease per account; aggregation pipeline makes concurrent refreshes idempotent.
      await LiveBroadcast.updateOne({ _id: room._id, ...active() }, [
        {
          $set: {
            viewers: {
              $concatArrays: [
                {
                  $filter: {
                    input: "$viewers",
                    as: "v",
                    cond: {
                      $and: [
                        {
                          $ne: [
                            "$$v.user",
                            new Types.ObjectId(String(req.user.id)),
                          ],
                        },
                        { $gt: ["$$v.heartbeatAt", lease()] },
                      ],
                    },
                  },
                },
                [
                  {
                    user: new Types.ObjectId(String(req.user.id)),
                    heartbeatAt: new Date(),
                  },
                ],
              ],
            },
          },
        },
      ]);
    }
    const fresh = await LiveBroadcast.findOne({ _id: room._id, ...active() });
    if (!fresh)
      return res
        .status(410)
        .json({ success: false, message: "This live has ended." });
    res.json({ success: true, data: clean(fresh) });
  })
);
router.post(
  "/rooms/:id/leave",
  wrap(async (req: any, res: any) => {
    await LiveBroadcast.updateOne(
      { _id: req.params.id },
      { $pull: { viewers: { user: req.user.id } } }
    );
    res.json({ success: true });
  })
);
router.post(
  "/rooms/:id/end",
  wrap(async (req: any, res: any) => {
    const room = await LiveBroadcast.findOneAndUpdate(
      { _id: req.params.id, host: req.user.id, status: "live" },
      {
        $set: {
          status: "ended",
          endedAt: new Date(),
          endReason: "Host ended live",
        },
      },
      { new: true }
    );
    res
      .status(room ? 200 : 404)
      .json({
        success: !!room,
        message: room ? "Live ended" : "Live room not found",
      });
  })
);
export default router;
