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
import { GiftTransaction, Gift } from "../gift/gift.model";
import { GiftService } from "../gift/gift.service";
import { User } from '../models/user.model';
import { getIOOptional } from "../sockets";
import { getLiveBroadcastRoomChannel } from "../sockets/liveBroadcastSocket";
import { incrementLiveSupporter, reserveLiveGuest } from '../services/liveBroadcastState';

const router = Router();
const lease = () => new Date(Date.now() - 90000);
const active = () => ({ status: "live", heartbeatAt: { $gt: lease() } });
const uid = (id: unknown) =>
  (parseInt(String(id).slice(-8), 16) % 4294967294) + 1;
const clean = (room: any) => {
  const { viewers, projectId, pin, ...data } = room.toObject
    ? room.toObject()
    : room;
  return {
    ...data,
    isPrivate: Boolean(data.isPrivate),
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
  const isCoHost = (room.guests || []).some((guest: any) => String(guest.user?._id || guest.user) === String(userId));
  const agoraUid = uid(userId);
  const channelName = `live_${room._id}`;
  const token = agoraToken.RtcTokenBuilder.buildTokenWithUid(
    project.appId,
    certificate,
    channelName,
    agoraUid,
    isHost || isCoHost ? agoraToken.RtcRole.PUBLISHER : agoraToken.RtcRole.SUBSCRIBER,
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
    isCoHost,
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
  wrap(async (req: AuthRequest, res: any) => {
    await expire();
    const query: any = active();
    const country = req.query.country ? String(req.query.country).trim() : '';
    if (country && country.toLowerCase() !== 'all') {
      query.country = new RegExp(`^${country}$`, 'i');
    }
    const category = req.query.category ? String(req.query.category).trim() : '';
    if (category && category !== 'Live' && category !== 'New') {
      query.category = category;
    }
    const rooms = await LiveBroadcast.find(query)
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(100)
      .populate("host", "name image avatar gender userId level country equippedSvipId");
    res.json({ success: true, data: rooms.map(clean) });
  })
);
router.post(
  "/rooms",
  wrap(async (req: AuthRequest, res: any) => {
    const title = String(req.body.title || "").trim();
    const category = String(req.body.category || "Live");
    const coverImage = String(req.body.coverImage || "").trim();
    const country = String(req.body.country || (req.user as any)?.country || "India").trim();
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
    const isPrivate = Boolean(req.body.isPrivate);
    const pin = String(req.body.pin || "").trim();
    if (isPrivate) {
      const hostUser = await User.findById(req.user!.id).select('canPrivateLive role').lean();
      const isAllowed = hostUser?.canPrivateLive === true || ['owner', 'superAdmin', 'admin'].includes(String(hostUser?.role));
      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          message: "Private live is not enabled for your account. Please contact admin to activate this feature.",
        });
      }
      if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        return res.status(400).json({
          success: false,
          message: "Please enter a valid 4-digit PIN for private live broadcast.",
        });
      }
    }
    const mode = req.body.mode === "multi" ? "multi" : "single";
    const requestedSeats = Number(req.body.seatCount);
    const seatCount = mode === "multi" ? ([4, 6, 9].includes(requestedSeats) ? requestedSeats : 4) : 2;
    const maxGuests = seatCount - 1;
    const room = await LiveBroadcast.create({
      host: req.user!.id,
      title,
      category,
      mode,
      maxGuests,
      seatCount,
      coverImage,
      country,
      isPrivate,
      pin: isPrivate ? pin : "",
      projectId: String(project._id),
      hostUid: uid(req.user!.id),
    });
    await room.populate("host", "name image avatar gender userId level country equippedSvipId");
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
    })
      .populate("host", "name image avatar gender userId level equippedSvipId")
      .populate("guests.user", "name image avatar gender userId level")
      .populate("pk.rivalHost", "name image avatar gender userId level")
      .populate("topContributors.user", "name image avatar gender userId level");
    if (!room)
      return res
        .status(404)
        .json({ success: false, message: "This live has ended." });

    if (room.isPrivate) {
      const hostIdStr = String((room.host as any)?._id || room.host);
      const isHost = hostIdStr === String(req.user?.id);
      if (!isHost) {
        const clientPin = String(req.body?.pin || "").trim();
        if (!clientPin || clientPin !== String((room as any).pin || "")) {
          return res.status(403).json({
            success: false,
            isLocked: true,
            message: "This live room is private. Please enter 4-digit password to join.",
          });
        }
      }
    }

    res.json({
      success: true,
      data: { room: clean(room), rtc: await credentials(room, req.user.id) },
    });
  })
);

router.post(
  "/rooms/:id/verify-pin",
  wrap(async (req: any, res: any) => {
    const room = await LiveBroadcast.findOne({ _id: req.params.id, ...active() });
    if (!room) return res.status(404).json({ success: false, message: "Live has ended." });
    if (!room.isPrivate) return res.json({ success: true, valid: true });
    const hostIdStr = String((room.host as any)?._id || room.host);
    if (hostIdStr === String(req.user?.id)) return res.json({ success: true, valid: true });

    const clientPin = String(req.body?.pin || "").trim();
    if (clientPin && clientPin === String((room as any).pin || "")) {
      return res.json({ success: true, valid: true });
    }
    return res.status(403).json({ success: false, valid: false, message: "Incorrect password" });
  })
);

router.post(
  "/rooms/:id/lock",
  wrap(async (req: any, res: any) => {
    const room = await LiveBroadcast.findOne({ _id: req.params.id, ...active() });
    if (!room) return res.status(404).json({ success: false, message: "Live room not found." });
    const hostIdStr = String((room.host as any)?._id || room.host);
    if (hostIdStr !== String(req.user?.id)) {
      return res.status(403).json({ success: false, message: "Only the host can lock or unlock this room." });
    }

    const hostUser = await User.findById(req.user!.id).select('canPrivateLive role').lean();
    const isAllowed = hostUser?.canPrivateLive === true || ['owner', 'superAdmin', 'admin'].includes(String(hostUser?.role));
    if (!isAllowed) {
      return res.status(403).json({ success: false, message: "Private live is not enabled for your account. Please contact admin." });
    }

    const shouldLock = Boolean(req.body.isLocked);
    const pin = String(req.body.pin || "").trim();
    if (shouldLock && (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin))) {
      return res.status(400).json({ success: false, message: "Please enter a 4-digit password." });
    }

    room.isPrivate = shouldLock;
    room.pin = shouldLock ? pin : "";
    await room.save();

    const io = getIOOptional();
    if (io) {
      const channel = getLiveBroadcastRoomChannel(String(room._id));
      io.to(channel).emit('live_broadcast:lock_state', {
        roomId: String(room._id),
        isPrivate: shouldLock,
      });
    }

    return res.json({
      success: true,
      data: { isPrivate: room.isPrivate },
      message: shouldLock ? "Live stream locked successfully." : "Live stream unlocked.",
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
router.post(
  "/rooms/:id/gift",
  wrap(async (req: any, res: any) => {
    const { giftId, quantity = 1, target = "host" } = req.body;
    const room = await LiveBroadcast.findById(req.params.id).populate("host", "name avatar image");
    if (!room || room.status !== "live") {
      return res.status(404).json({ success: false, message: "Live broadcast is not active." });
    }

    const gift = await Gift.findById(giftId).lean();
    if (!gift) {
      return res.status(404).json({ success: false, message: "Gift not found." });
    }

    const qty = Math.max(1, Math.min(Number(quantity) || 1, 999));
    const unitPrice = Number(gift.price || gift.cost || 1);
    const totalCost = unitPrice * qty;

    let receiverId = room.host?._id ? String(room.host._id) : String(room.host);
    if (target === "rival" && room.pk?.isActive && room.pk?.rivalHost) {
      receiverId = String(room.pk.rivalHost);
    }

    const settlement = await GiftService.sendGift(req.user.id, {
      requestId: `rest-live-gift-${Date.now()}-${req.user.id}`,
      giftId: String(gift._id),
      quantity: qty,
      receiverId,
      roomId: String(room._id),
    });

    const senderUser = await User.findById(req.user.id).select("name avatar image gender level").lean();

    const updatedRoom = await LiveBroadcast.findByIdAndUpdate(
      room._id,
      {
        $inc: {
          totalDiamonds: totalCost,
          ...(room.pk?.isActive
            ? target === "rival"
              ? { "pk.rightScore": totalCost }
              : { "pk.leftScore": totalCost }
            : {}),
        },
      },
      { new: true }
    ).populate("topContributors.user", "name avatar image userId");

    await incrementLiveSupporter(String(room._id), String(req.user.id), totalCost);
    const supporters = await LiveBroadcast.findById(room._id)
      .populate('topContributors.user', 'name avatar image userId').lean();
    const giftEvent = {
      roomId: String(room._id),
      transactionId: String(settlement.transaction?._id || ''),
      quantity: qty,
      receiver: {
        id: receiverId,
        name:
          target === 'rival' ? 'Rival host' : (room.host as any)?.name || 'Host',
      },
      sender: {
        id: String(req.user.id),
        name: senderUser?.name || 'Donor',
        avatar: (senderUser as any)?.avatar || senderUser?.image,
        level: senderUser?.level || 1,
      },
      target,
      receiverId,
      gift: {
        id: String(gift._id),
        name: gift.name,
        icon: gift.icon,
        image: gift.image || gift.previewUrl || '',
        animationUrl: gift.animationUrl || '',
        mediaType: gift.mediaType || 'image',
        animationType: gift.animationType || 'NORMAL',
        duration: gift.duration || 4200,
        price: unitPrice,
        quantity: qty,
      },
      totalDiamonds: updatedRoom?.totalDiamonds || totalCost,
      leftScore: updatedRoom?.pk?.leftScore || 0,
      rightScore: updatedRoom?.pk?.rightScore || 0,
      topSupporters: (supporters?.topContributors || []).map(
        (tc: any, i: number) => ({
          id: String(tc.user?._id || tc.user),
          name: tc.user?.name || 'Supporter',
          avatar: tc.user?.avatar || tc.user?.image,
          score:
            tc.amount > 999
              ? `${Math.round(tc.amount / 1000)}K`
              : String(tc.amount),
          crown: i === 0 ? '#F59E0B' : i === 1 ? '#94A3B8' : '#CD7F32',
        }),
      ),
    };
    const io = getIOOptional();
    if (io) {
      const roomChannel = getLiveBroadcastRoomChannel(String(room._id));
      io.to(roomChannel).emit("live:gift_received", giftEvent);

      io.to(roomChannel).emit("live:chat_message", {
        id: `gift-${Date.now()}-${req.user.id}`,
        type: "gift",
        senderId: String(req.user.id),
        senderName: senderUser?.name || "User",
        avatar: (senderUser as any)?.avatar || senderUser?.image,
        level: senderUser?.level || 1,
        text: `Sent ${gift.name} x ${qty}`,
        giftIcon: gift.icon,
        giftName: gift.name,
        quantity: qty,
        timestamp: Date.now(),
      });
    }

    res.json({
      success: true,
      data: {
        giftEvent,
        totalDiamonds: updatedRoom?.totalDiamonds || totalCost,
        leftScore: updatedRoom?.pk?.leftScore || 0,
        rightScore: updatedRoom?.pk?.rightScore || 0,
      },
    });
  })
);

router.post(
  "/rooms/:id/like",
  wrap(async (req: any, res: any) => {
    const count = Math.min(Math.max(1, Number(req.body.count) || 1), 10);
    const updated = await LiveBroadcast.findByIdAndUpdate(
      req.params.id,
      { $inc: { totalLikes: count } },
      { new: true }
    ).select("totalLikes").lean();

    const io = getIOOptional();
    if (io) {
      io.to(getLiveBroadcastRoomChannel(req.params.id)).emit("live:like_update", {
        totalLikes: updated?.totalLikes || 1,
        increment: count,
        senderId: String(req.user.id),
      });
    }
    res.json({ success: true, data: { totalLikes: updated?.totalLikes || 1 } });
  })
);

router.post(
  "/rooms/:id/apply",
  wrap(async (req: any, res: any) => {
    const room = await LiveBroadcast.findById(req.params.id).populate("host", "name avatar image");
    if (!room || room.status !== "live") {
      return res.status(404).json({ success: false, message: "Room is not live" });
    }
    await LiveBroadcast.updateOne(
      { _id: room._id },
      { $addToSet: { joinRequests: { user: new Types.ObjectId(req.user.id), requestedAt: new Date() } } }
    );
    const dbUser = await User.findById(req.user.id).select("name avatar image level").lean();
    const io = getIOOptional();
    if (io) {
      io.to(`user:${room.host?._id || room.host}`).emit("live:join_request_received", {
        user: {
          id: String(req.user.id),
          name: dbUser?.name || "Viewer",
          avatar: (dbUser as any)?.avatar || dbUser?.image,
          level: dbUser?.level || 1,
        },
        roomId: String(room._id),
      });
    }
    res.json({ success: true, message: "Application sent" });
  })
);

router.post(
  "/rooms/:id/accept_guest",
  wrap(async (req: any, res: any) => {
    const { targetUserId } = req.body;
    if (!Types.ObjectId.isValid(String(targetUserId || ''))) {
      return res.status(400).json({ success: false, message: 'Invalid guest ID.' });
    }
    const room = await LiveBroadcast.findById(req.params.id);
    if (!room || room.status !== 'live' || String(room.host) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const limit = room.maxGuests || (room.mode === "multi" ? 6 : 1);
    if ((room.guests || []).length >= limit) {
      return res.status(400).json({ success: false, message: `Maximum ${limit} guest(s) allowed` });
    }
    const guestUid = uid(targetUserId);
    const { project, certificate } = await AgoraTokenService.resolveProject(room.projectId);
    const guestToken = agoraToken.RtcTokenBuilder.buildTokenWithUid(
      project.appId,
      certificate,
      `live_${room._id}`,
      guestUid,
      agoraToken.RtcRole.PUBLISHER,
      3600,
      3600
    );
    if (!await reserveLiveGuest(String(room._id), String(req.user.id), targetUserId, guestUid, limit)) {
      return res.status(409).json({ success: false, message: 'Guest already joined or the live layout is full.' });
    }
    const guestUser = await User.findById(targetUserId).select("name avatar image level").lean();
    const io = getIOOptional();
    if (io) {
      io.to(`user:${targetUserId}`).emit("live:guest_accepted", {
        roomId: String(room._id),
        rtc: {
          appId: project.appId,
          channelName: `live_${room._id}`,
          token: guestToken,
          agoraUid: guestUid,
          isHost: false,
          isCoHost: true,
        },
      });
      io.to(getLiveBroadcastRoomChannel(String(room._id))).emit("live:guest_joined", {
        guest: {
          id: targetUserId,
          name: guestUser?.name || "Guest",
          avatar: (guestUser as any)?.avatar || guestUser?.image,
          agoraUid: guestUid,
        },
      });
    }
    res.json({ success: true, message: "Guest accepted" });
  })
);

router.post(
  "/rooms/:id/reject_guest",
  wrap(async (req: any, res: any) => {
    const { targetUserId } = req.body;
    await LiveBroadcast.updateOne(
      { _id: req.params.id },
      { $pull: { joinRequests: { user: new Types.ObjectId(targetUserId) } } }
    );
    const io = getIOOptional();
    if (io) {
      io.to(`user:${targetUserId}`).emit("live:guest_rejected", { roomId: req.params.id });
    }
    res.json({ success: true, message: "Guest rejected" });
  })
);

router.post(
  "/rooms/:id/leave_guest",
  wrap(async (req: any, res: any) => {
    await LiveBroadcast.updateOne(
      { _id: req.params.id },
      { $pull: { guests: { user: new Types.ObjectId(req.user.id) } } }
    );
    const io = getIOOptional();
    if (io) {
      io.to(getLiveBroadcastRoomChannel(req.params.id)).emit("live:guest_left", { userId: String(req.user.id) });
    }
    res.json({ success: true, message: "Guest left" });
  })
);

export default router;
