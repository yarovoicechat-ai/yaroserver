import { Server } from "socket.io";
import { Types } from "mongoose";
import agoraToken from "agora-token";
import LiveBroadcast from "../models/liveBroadcast.model";
import { User } from "../models/user.model";
import { Gift } from "../gift/gift.model";
import { GiftService } from "../gift/gift.service";
import { AuthenticatedSocket } from "../middlewares/auth.socket";
import { AgoraTokenService } from "../services/agora/agoraToken.service";
import { EntryEffectService } from '../services/entryEffect.service';
import { incrementLiveSupporter, reserveLiveGuest } from '../services/liveBroadcastState';

const uid = (id: unknown) =>
  (parseInt(String(id).slice(-8), 16) % 4294967294) + 1;

export const getLiveBroadcastRoomChannel = (roomId: string) =>
  `live_broadcast_room:${roomId}`;

export const registerLiveBroadcastHandlers = (io: Server, socket: AuthenticatedSocket) => {
  const user = socket.user;
  if (!user?.id) return;

  const userIdStr = user.id.toString();

  // 1. Join Live Broadcast Room
  socket.on("live:join", async ({ roomId }: { roomId: string }) => {
    try {
      if (!roomId || !Types.ObjectId.isValid(roomId)) return;
      const roomChannel = getLiveBroadcastRoomChannel(roomId);
      if (socket.rooms.has(roomChannel)) return;
      await socket.join(roomChannel);

      const dbUser: any = await User.findById(user.id)
        .select("name avatar image gender level equippedSvipId")
        .lean();

      // Add to room viewers in DB
      await LiveBroadcast.updateOne(
        { _id: roomId, status: "live" },
        {
          $addToSet: {
            viewers: { user: new Types.ObjectId(userIdStr), heartbeatAt: new Date() },
          },
        }
      );

      const room = await LiveBroadcast.findById(roomId)
        .populate("host", "name avatar image userId level")
        .populate("guests.user", "name avatar image userId level")
        .populate("pk.rivalHost", "name avatar image userId level")
        .populate("topContributors.user", "name avatar image userId level")
        .lean();

      const viewerCount = (room?.viewers || []).length;
      if (!room || room.status !== 'live') {
        await socket.leave(roomChannel);
        return;
      }

      // Broadcast viewer joined to all clients in the live room
      io.to(roomChannel).emit("live:viewer_joined", {
        user: {
          id: userIdStr,
          name: dbUser?.name || "Viewer",
          avatar: dbUser?.avatar || dbUser?.image,
          level: dbUser?.level || 1,
          isSvip: Boolean(dbUser?.equippedSvipId),
        },
        viewerCount,
      });

      // Broadcast real system entry announcement in chat
      io.to(roomChannel).emit("live:chat_message", {
        id: `entry-${Date.now()}-${userIdStr}`,
        type: "entry",
        senderId: userIdStr,
        senderName: dbUser?.name || "Viewer",
        avatar: dbUser?.avatar || dbUser?.image,
        level: dbUser?.level || 1,
        isSvip: Boolean(dbUser?.equippedSvipId),
        text: `${dbUser?.name || "User"} entered the broadcast 🌟`,
        timestamp: Date.now(),
      });
      await EntryEffectService.broadcastEntry(roomId, { id: user.id, ...dbUser }, undefined, io);
    } catch (err: any) {
      console.error("[live:join] Error:", err.message);
    }
  });

  // 2. Leave Live Broadcast Room
  socket.on("live:leave", async ({ roomId }: { roomId: string }) => {
    try {
      if (!roomId || !Types.ObjectId.isValid(roomId)) return;
      const roomChannel = getLiveBroadcastRoomChannel(roomId);
      socket.leave(roomChannel);

      await LiveBroadcast.updateOne(
        { _id: roomId },
        { $pull: { viewers: { user: new Types.ObjectId(userIdStr) } } }
      );

      const room = await LiveBroadcast.findById(roomId).select("viewers").lean();
      const viewerCount = (room?.viewers || []).length;

      io.to(roomChannel).emit("live:viewer_left", {
        userId: userIdStr,
        viewerCount,
      });
    } catch (err: any) {
      console.error("[live:leave] Error:", err.message);
    }
  });

  // 3. Send Chat Message
  socket.on("live:chat", async ({ roomId, text }: { roomId: string; text: string }) => {
    try {
      if (!roomId || !text || !text.trim()) return;
      const cleanText = text.trim().slice(0, 200);
      const roomChannel = getLiveBroadcastRoomChannel(roomId);

      const dbUser: any = await User.findById(user.id)
        .select("name avatar image gender level equippedSvipId")
        .lean();

      io.to(roomChannel).emit("live:chat_message", {
        id: `chat-${Date.now()}-${userIdStr}`,
        type: "user",
        senderId: userIdStr,
        senderName: dbUser?.name || "User",
        avatar: dbUser?.avatar || dbUser?.image,
        level: dbUser?.level || 1,
        isSvip: Boolean(dbUser?.equippedSvipId),
        text: cleanText,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      console.error("[live:chat] Error:", err.message);
    }
  });

  // 4. Double Tap Heart / Like
  socket.on("live:like", async ({ roomId, count = 1 }: { roomId: string; count?: number }) => {
    try {
      if (!roomId || !Types.ObjectId.isValid(roomId)) return;
      const safeCount = Math.min(Math.max(1, count), 10);
      const roomChannel = getLiveBroadcastRoomChannel(roomId);

      const updated = await LiveBroadcast.findByIdAndUpdate(
        roomId,
        { $inc: { totalLikes: safeCount } },
        { new: true }
      ).select("totalLikes").lean();

      io.to(roomChannel).emit("live:like_update", {
        totalLikes: updated?.totalLikes || 1,
        increment: safeCount,
        senderId: userIdStr,
      });
    } catch (err: any) {
      console.error("[live:like] Error:", err.message);
    }
  });

  // 5. Send Gift
  socket.on(
    "live:send_gift",
    async ({
      roomId,
      giftId,
      quantity = 1,
      target = "host",
    }: {
      roomId: string;
      giftId: string;
      quantity?: number;
      target?: "host" | "rival";
    }) => {
      try {
        if (!roomId || !Types.ObjectId.isValid(roomId)) return;
        const room: any = await LiveBroadcast.findById(roomId).populate("host", "name avatar image");
        if (!room || room.status !== "live") {
          socket.emit("live:error", { message: "Live broadcast is not active." });
          return;
        }

        const gift = await Gift.findById(giftId).lean();
        if (!gift) {
          socket.emit("live:error", { message: "Gift not found." });
          return;
        }

        const qty = Math.max(1, Math.min(Number(quantity) || 1, 999));
        const unitPrice = Number(gift.price || gift.cost || 1);
        const totalCost = unitPrice * qty;

        // Determine recipient
        let receiverId = room.host?._id ? String(room.host._id) : String(room.host);
        if (target === "rival" && room.pk?.isActive && room.pk?.rivalHost) {
          receiverId = String(room.pk.rivalHost);
        }

        // Deduct diamonds using GiftService
        const settlement = await GiftService.sendGift(user.id, {
          requestId: `live-gift-${Date.now()}-${user.id}`,
          giftId: String(gift._id),
          quantity: qty,
          receiverId,
          roomId,
        });

        const senderUser: any = await User.findById(user.id)
          .select("name avatar image gender level")
          .lean();

        // Update live room total diamonds & top contributors
        await LiveBroadcast.findByIdAndUpdate(
          roomId,
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
        )
          .populate("topContributors.user", "name avatar image")
          .lean();

        await incrementLiveSupporter(roomId, userIdStr, totalCost);

        const freshRoom: any = await LiveBroadcast.findById(roomId)
          .populate("topContributors.user", "name avatar image userId")
          .lean();

        const roomChannel = getLiveBroadcastRoomChannel(roomId);

        // Broadcast gift banner / animation to all clients
        io.to(roomChannel).emit("live:gift_received", {
          roomId,
          transactionId: String(settlement.transaction?._id || ''),
          quantity: qty,
          receiver: { id: receiverId, name: target === 'rival' ? 'Rival host' : room.host?.name || 'Host' },
          sender: {
            id: userIdStr,
            name: senderUser?.name || "Donor",
            avatar: senderUser?.avatar || senderUser?.image,
            level: senderUser?.level || 1,
          },
          target,
          receiverId,
          gift: {
            id: String(gift._id),
            name: gift.name,
            icon: gift.icon,
            image: gift.image || gift.icon,
            animationUrl: gift.animationUrl || '',
            mediaType: gift.mediaType || 'image',
            animationType: gift.animationType || 'NORMAL',
            duration: gift.duration || 4200,
            price: unitPrice,
            quantity: qty,
          },
          totalDiamonds: freshRoom?.totalDiamonds || totalCost,
          leftScore: freshRoom?.pk?.leftScore || 0,
          rightScore: freshRoom?.pk?.rightScore || 0,
          topSupporters: (freshRoom?.topContributors || []).map((tc: any, i: number) => ({
            id: String(tc.user?._id || tc.user),
            name: tc.user?.name || "Supporter",
            avatar: tc.user?.avatar || tc.user?.image,
            score: tc.amount > 999 ? `${Math.round(tc.amount / 1000)}K` : String(tc.amount),
            crown: i === 0 ? "#F59E0B" : i === 1 ? "#94A3B8" : "#CD7F32",
          })),
        });

        // Broadcast gift chat announcement
        io.to(roomChannel).emit("live:chat_message", {
          id: `gift-${Date.now()}-${userIdStr}`,
          type: "gift",
          senderId: userIdStr,
          senderName: senderUser?.name || "User",
          avatar: senderUser?.avatar || senderUser?.image,
          level: senderUser?.level || 1,
          text: `Sent ${gift.name} x ${qty}`,
          giftIcon: gift.icon,
          giftName: gift.name,
          quantity: qty,
          timestamp: Date.now(),
        });

        // Also if PK is active, synchronize PK scores to both current and rival rooms
        if (room.pk?.isActive) {
          io.to(roomChannel).emit("live:pk_score_update", {
            leftScore: freshRoom?.pk?.leftScore || 0,
            rightScore: freshRoom?.pk?.rightScore || 0,
          });

          if (room.pk?.rivalRoomId) {
            const rivalRoomId = String(room.pk.rivalRoomId);
            const rivalScoreInc = target === "rival"
              ? { "pk.leftScore": totalCost }
              : { "pk.rightScore": totalCost };

            LiveBroadcast.findByIdAndUpdate(
              rivalRoomId,
              { $inc: rivalScoreInc },
              { new: true }
            ).then(updatedRival => {
              const rivalChannel = getLiveBroadcastRoomChannel(rivalRoomId);
              io.to(rivalChannel).emit("live:pk_score_update", {
                leftScore: updatedRival?.pk?.leftScore || 0,
                rightScore: updatedRival?.pk?.rightScore || 0,
              });
            }).catch(err => {
              console.error("[live:send_gift PK rival sync] Error:", err?.message);
            });
          }
        }
      } catch (err: any) {
        console.error("[live:send_gift] Error:", err.message);
        socket.emit("live:error", { message: err.message || "Failed to send gift." });
      }
    }
  );

  // 6. Guest Co-Host: Viewer applies to join
  socket.on("live:apply_join", async ({ roomId }: { roomId: string }) => {
    try {
      if (!roomId || !Types.ObjectId.isValid(roomId)) return;
      const room: any = await LiveBroadcast.findById(roomId).populate("host", "name avatar image");
      if (!room || room.status !== "live") return;
      if (String(room.host?._id || room.host) === userIdStr) return;
      if ((room.guests || []).some((guest: any) => String(guest.user) === userIdStr)) return;
      if ((room.joinRequests || []).some((request: any) => String(request.user) === userIdStr)) {
        socket.emit("live:notice", { message: "Your connection request is already pending." });
        return;
      }

      const dbUser: any = await User.findById(user.id).select("name avatar image userId level").lean();

      await LiveBroadcast.updateOne(
        { _id: roomId, status: "live", "joinRequests.user": { $ne: new Types.ObjectId(userIdStr) } },
        {
          $addToSet: {
            joinRequests: { user: new Types.ObjectId(userIdStr), requestedAt: new Date() },
          },
        }
      );

      // Send application request directly to the host
      const hostRoom = `user:${room.host?._id || room.host}`;
      io.to(hostRoom).emit("live:join_request_received", {
        user: {
          id: userIdStr,
          name: dbUser?.name || "Viewer",
          avatar: dbUser?.avatar || dbUser?.image,
          level: dbUser?.level || 1,
        },
        roomId,
      });

      socket.emit("live:notice", { message: "Application sent to broadcaster." });
    } catch (err: any) {
      console.error("[live:apply_join] Error:", err.message);
    }
  });

  // 7. Host Accepts Guest Co-Host
  socket.on("live:accept_guest", async ({ roomId, targetUserId }: { roomId: string; targetUserId: string }) => {
    try {
      if (!roomId || !targetUserId || !Types.ObjectId.isValid(roomId) || !Types.ObjectId.isValid(targetUserId)) return;
      const room = await LiveBroadcast.findById(roomId);
      if (!room || room.status !== 'live' || String(room.host) !== userIdStr) {
        socket.emit("live:error", { message: "Only the broadcaster can accept guests." });
        return;
      }
      if (!(room.joinRequests || []).some((request: any) => String(request.user) === targetUserId) ||
          (room.guests || []).some((guest: any) => String(guest.user) === targetUserId)) return;

      const limit = room.maxGuests || (room.mode === "multi" ? 6 : 1);
      if ((room.guests || []).length >= limit) {
        socket.emit("live:error", { message: `Maximum ${limit} guest(s) allowed in ${room.mode} mode.` });
        return;
      }

      const guestUid = uid(targetUserId);

      // Generate Agora Publisher Token for the accepted guest
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

      if (!await reserveLiveGuest(roomId, userIdStr, targetUserId, guestUid, limit)) {
        socket.emit('live:error', { message: 'Guest already joined or the live layout is full.' });
        return;
      }

      const guestUser: any = await User.findById(targetUserId).select("name avatar image userId level").lean();
      const targetUserRoom = `user:${targetUserId}`;

      // Notify the accepted guest with RTC credentials
      io.to(targetUserRoom).emit("live:guest_accepted", {
        roomId,
        rtc: {
          appId: project.appId,
          channelName: `live_${room._id}`,
          token: guestToken,
          agoraUid: guestUid,
          isHost: false,
          isCoHost: true,
        },
      });

      // Broadcast to all viewers that a new guest joined
      const roomChannel = getLiveBroadcastRoomChannel(roomId);
      io.to(roomChannel).emit("live:guest_joined", {
        guest: {
          id: targetUserId,
          name: guestUser?.name || "Guest",
          avatar: guestUser?.avatar || guestUser?.image,
          agoraUid: guestUid,
        },
      });

      io.to(roomChannel).emit("live:chat_message", {
        id: `guest-${Date.now()}-${targetUserId}`,
        type: "system",
        text: `🎉 ${guestUser?.name || "Guest"} joined as co-host!`,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      console.error("[live:accept_guest] Error:", err.message);
    }
  });

  socket.on('live:guest_media', async ({ roomId, muted, camera }: { roomId: string; muted: boolean; camera: boolean }) => {
    try {
      if (!Types.ObjectId.isValid(roomId) || typeof muted !== 'boolean' || typeof camera !== 'boolean') return;
      const room = await LiveBroadcast.findOne({ _id: roomId, status: 'live', 'guests.user': userIdStr }).lean();
      const guest = room?.guests?.find((item: any) => String(item.user) === userIdStr);
      if (!guest) return;
      await LiveBroadcast.updateOne({ _id: roomId, 'guests.user': userIdStr },
        { $set: { 'guests.$.muted': muted, 'guests.$.camera': camera } });
      io.to(getLiveBroadcastRoomChannel(roomId)).emit('live:guest_media', {
        roomId, userId: userIdStr, agoraUid: guest.agoraUid, muted, camera,
      });
    } catch (error: any) { socket.emit('live:error', { message: error.message || 'Could not update guest controls.' }); }
  });

  socket.on('live:mute_guest', async ({ roomId, targetUserId }: { roomId: string; targetUserId: string }) => {
    try {
      if (!Types.ObjectId.isValid(roomId) || !Types.ObjectId.isValid(targetUserId)) return;
      const room = await LiveBroadcast.findOne({ _id: roomId, host: userIdStr, status: 'live' }).lean();
      const guest = room?.guests?.find((item: any) => String(item.user) === targetUserId);
      if (!guest) return;
      await LiveBroadcast.updateOne({ _id: roomId, 'guests.user': targetUserId }, { $set: { 'guests.$.muted': true } });
      io.to(getLiveBroadcastRoomChannel(roomId)).emit('live:guest_media', {
        roomId, userId: targetUserId, agoraUid: guest.agoraUid, muted: true, camera: guest.camera !== false,
      });
    } catch (error: any) { socket.emit('live:error', { message: error.message || 'Could not mute guest.' }); }
  });

  // 8. Host Rejects Guest Co-Host
  socket.on("live:reject_guest", async ({ roomId, targetUserId }: { roomId: string; targetUserId: string }) => {
    try {
      if (!Types.ObjectId.isValid(roomId) || !Types.ObjectId.isValid(targetUserId)) return;
      const room = await LiveBroadcast.findOne({ _id: roomId, host: userIdStr, status: 'live' }).select('_id').lean();
      if (!room) return;
      await LiveBroadcast.updateOne(
        { _id: roomId },
        { $pull: { joinRequests: { user: new Types.ObjectId(targetUserId) } } }
      );
      io.to(`user:${targetUserId}`).emit("live:guest_rejected", { roomId });
    } catch (err: any) {
      console.error("[live:reject_guest] Error:", err.message);
    }
  });

  // 9. Guest Leaves Co-Host Seat
  socket.on("live:leave_guest", async ({ roomId }: { roomId: string }) => {
    try {
      if (!roomId) return;
      await LiveBroadcast.updateOne(
        { _id: roomId },
        { $pull: { guests: { user: new Types.ObjectId(userIdStr) } } }
      );
      const roomChannel = getLiveBroadcastRoomChannel(roomId);
      io.to(roomChannel).emit("live:guest_left", { userId: userIdStr });
    } catch (err: any) {
      console.error("[live:leave_guest] Error:", err.message);
    }
  });

  // 10. PK Battle: Host invites rival
  socket.on("live:pk_invite", async ({ roomId, targetRoomId }: { roomId: string; targetRoomId: string }) => {
    try {
      if (!roomId || !targetRoomId) return;
      const currentRoom: any = await LiveBroadcast.findById(roomId).populate("host", "name avatar image userId");
      const targetRoom: any = await LiveBroadcast.findById(targetRoomId).populate("host", "name avatar image userId");

      if (!targetRoom || targetRoom.status !== "live") {
        socket.emit("live:error", { message: "Selected room is not live." });
        return;
      }

      const rivalHostRoom = `user:${targetRoom.host?._id || targetRoom.host}`;
      io.to(rivalHostRoom).emit("live:pk_invitation_received", {
        fromRoomId: roomId,
        fromHost: {
          id: userIdStr,
          name: currentRoom?.host?.name || "Host",
          avatar: currentRoom?.host?.avatar || currentRoom?.host?.image,
        },
      });

      socket.emit("live:notice", { message: "PK challenge sent!" });
    } catch (err: any) {
      console.error("[live:pk_invite] Error:", err.message);
    }
  });

  // 11. PK Battle: Accept Challenge and Start PK
  socket.on("live:pk_accept", async ({ roomId, inviterRoomId }: { roomId: string; inviterRoomId: string }) => {
    try {
      if (!roomId || !inviterRoomId) return;
      const room1: any = await LiveBroadcast.findById(roomId).populate("host", "name avatar image userId");
      const room2: any = await LiveBroadcast.findById(inviterRoomId).populate("host", "name avatar image userId");

      if (!room1 || !room2) return;

      const duration = 300; // 5 minutes
      const now = new Date();
      const endTime = new Date(now.getTime() + duration * 1000);

      // Setup PK on room 1
      await LiveBroadcast.updateOne(
        { _id: roomId },
        {
          $set: {
            "pk.isActive": true,
            "pk.rivalRoomId": new Types.ObjectId(inviterRoomId),
            "pk.rivalHost": room2.host?._id,
            "pk.durationSeconds": duration,
            "pk.startTime": now,
            "pk.endTime": endTime,
            "pk.leftScore": 0,
            "pk.rightScore": 0,
          },
        }
      );

      // Setup PK on room 2
      await LiveBroadcast.updateOne(
        { _id: inviterRoomId },
        {
          $set: {
            "pk.isActive": true,
            "pk.rivalRoomId": new Types.ObjectId(roomId),
            "pk.rivalHost": room1.host?._id,
            "pk.durationSeconds": duration,
            "pk.startTime": now,
            "pk.endTime": endTime,
            "pk.leftScore": 0,
            "pk.rightScore": 0,
          },
        }
      );

      // Broadcast PK started to Room 1
      io.to(getLiveBroadcastRoomChannel(roomId)).emit("live:pk_started", {
        isPK: true,
        rivalRoomId: inviterRoomId,
        rivalHost: {
          id: String(room2.host?._id || room2.host),
          name: room2.host?.name || "Rival",
          avatar: room2.host?.avatar || room2.host?.image,
        },
        durationSeconds: duration,
        leftScore: 0,
        rightScore: 0,
      });

      // Broadcast PK started to Room 2
      io.to(getLiveBroadcastRoomChannel(inviterRoomId)).emit("live:pk_started", {
        isPK: true,
        rivalRoomId: roomId,
        rivalHost: {
          id: String(room1.host?._id || room1.host),
          name: room1.host?.name || "Rival",
          avatar: room1.host?.avatar || room1.host?.image,
        },
        durationSeconds: duration,
        leftScore: 0,
        rightScore: 0,
      });
    } catch (err: any) {
      console.error("[live:pk_accept] Error:", err.message);
    }
  });

  // 12. PK Battle: End PK
  socket.on("live:pk_end", async ({ roomId }: { roomId: string }) => {
    try {
      if (!roomId) return;
      const room = await LiveBroadcast.findById(roomId);
      if (!room || !room.pk?.isActive) return;

      const rivalRoomId = room.pk.rivalRoomId ? String(room.pk.rivalRoomId) : null;
      const leftScore = room.pk.leftScore || 0;
      const rightScore = room.pk.rightScore || 0;

      let winner: "left" | "right" | "draw" = "draw";
      if (leftScore > rightScore) winner = "left";
      else if (rightScore > leftScore) winner = "right";

      // Reset PK state on room
      await LiveBroadcast.updateOne(
        { _id: roomId },
        { $set: { "pk.isActive": false } }
      );

      io.to(getLiveBroadcastRoomChannel(roomId)).emit("live:pk_ended", {
        winner,
        leftScore,
        rightScore,
      });

      if (rivalRoomId) {
        await LiveBroadcast.updateOne(
          { _id: rivalRoomId },
          { $set: { "pk.isActive": false } }
        );
        io.to(getLiveBroadcastRoomChannel(rivalRoomId)).emit("live:pk_ended", {
          winner: winner === "left" ? "right" : winner === "right" ? "left" : "draw",
          leftScore: rightScore,
          rightScore: leftScore,
        });
      }
    } catch (err: any) {
      console.error("[live:pk_end] Error:", err.message);
    }
  });
};
