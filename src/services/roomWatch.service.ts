import axios from 'axios';
import { Room } from '../models/room.model';
import { RoomWatchSession, IRoomWatchSession } from '../models/roomWatchSession.model';
import { getIOOptional } from '../sockets';
import redis from '../configs/redisConfig';

export class RoomWatchError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function normalizeWatchRoomId(roomId: string): string {
  if (!roomId) return '';
  const raw = String(roomId).trim();
  return raw.startsWith('room_') ? raw : `room_${raw}`;
}

function parseDurationSeconds(durationStr: string): number {
  if (!durationStr) return 0;
  // Handle ISO 8601 duration format (PT4M48S) from YouTube Data API v3
  if (durationStr.startsWith('PT')) {
    const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (match) {
      const hours = parseInt(match[1] || '0', 10);
      const minutes = parseInt(match[2] || '0', 10);
      const seconds = parseInt(match[3] || '0', 10);
      return hours * 3600 + minutes * 60 + seconds;
    }
  }
  // Handle MM:SS or HH:MM:SS format
  const parts = durationStr.split(':').map(p => parseInt(p, 10));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  if (hrs > 0) {
    return `${hrs}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Real YouTube Video Search using YouTube Data API v3 with automatic web fallback
 */
export async function searchYouTube(query = '', pageToken = ''): Promise<{
  items: Array<{
    videoId: string;
    title: string;
    thumbnail: string;
    channelTitle: string;
    duration: string;
    durationSeconds: number;
  }>;
  nextPageToken?: string;
}> {
  const q = String(query || '').trim() || 'trending hindi music songs';
  const apiKey = process.env.YOUTUBE_API_KEY;

  // 1. Try YouTube Data API v3 if API key is provided
  if (apiKey) {
    try {
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(q)}&maxResults=20&key=${apiKey}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const searchRes = await axios.get(searchUrl, { timeout: 8000 });
      const items = searchRes.data?.items || [];
      const videoIds = items.map((it: any) => it.id?.videoId).filter(Boolean);

      let durationMap: Record<string, string> = {};
      if (videoIds.length > 0) {
        try {
          const videosUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds.join(',')}&key=${apiKey}`;
          const videosRes = await axios.get(videosUrl, { timeout: 8000 });
          for (const v of videosRes.data?.items || []) {
            if (v.id && v.contentDetails?.duration) {
              durationMap[v.id] = v.contentDetails.duration;
            }
          }
        } catch {
          // Non-critical: duration fallback
        }
      }

      const results = items
        .filter((it: any) => it.id?.videoId)
        .map((it: any) => {
          const vid = it.id.videoId;
          const rawDuration = durationMap[vid] || '';
          const durSec = parseDurationSeconds(rawDuration);
          return {
            videoId: vid,
            title: it.snippet?.title || 'YouTube Video',
            thumbnail: it.snippet?.thumbnails?.high?.url || it.snippet?.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
            channelTitle: it.snippet?.channelTitle || 'YouTube Channel',
            duration: durSec > 0 ? formatDuration(durSec) : '03:45',
            durationSeconds: durSec > 0 ? durSec : 225,
          };
        });

      if (results.length > 0) {
        return {
          items: results,
          nextPageToken: searchRes.data?.nextPageToken,
        };
      }
    } catch (apiErr: any) {
      console.warn('[RoomWatch] YouTube Data API notice, using web fallback:', apiErr?.message);
    }
  }

  // 2. High-reliability Web Fallback (Scrapes actual YouTube Search results from official ytInitialData)
  try {
    const webUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    const webRes = await axios.get(webUrl, {
      timeout: 9000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const html = String(webRes.data || '');
    const match = html.match(/var ytInitialData = ({.*?});<\/script>/);
    if (match && match[1]) {
      const data = JSON.parse(match[1]);
      const results: any[] = [];
      const contents =
        data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];

      for (const sec of contents) {
        for (const item of sec?.itemSectionRenderer?.contents || []) {
          const vr = item?.videoRenderer;
          if (vr && vr.videoId) {
            const vid = vr.videoId;
            const title = vr.title?.runs?.[0]?.text || vr.title?.simpleText || 'YouTube Video';
            const channel = vr.ownerText?.runs?.[0]?.text || 'YouTube Channel';
            const duration = vr.lengthText?.simpleText || '03:30';
            const durSec = parseDurationSeconds(duration);
            const thumbs = vr.thumbnail?.thumbnails || [];
            const thumbnail = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;

            results.push({
              videoId: vid,
              title,
              thumbnail,
              channelTitle: channel,
              duration,
              durationSeconds: durSec > 0 ? durSec : 210,
            });
          }
        }
      }

      if (results.length > 0) {
        return { items: results };
      }
    }
  } catch (webErr: any) {
    console.warn('[RoomWatch] Web fallback parse notice:', webErr?.message);
  }

  // 3. Fallback to curated real YouTube popular songs (guaranteed real video IDs)
  return {
    items: [
      {
        videoId: 'qyyIqaSaQS0',
        title: "Haqdar Hoon - Emraan Hashmi & Genelia D'Souza | Sagar Bairagi",
        thumbnail: 'https://i.ytimg.com/vi/qyyIqaSaQS0/hq720.jpg',
        channelTitle: 'Sagar Bairagi',
        duration: '04:48',
        durationSeconds: 288,
      },
      {
        videoId: 'CEbB9kdu8ng',
        title: 'GUZARISH (गुज़ारिश) - Satinder Sartaaj | Bhushan Kumar',
        thumbnail: 'https://i.ytimg.com/vi/CEbB9kdu8ng/hq720.jpg',
        channelTitle: 'T-Series',
        duration: '04:51',
        durationSeconds: 291,
      },
      {
        videoId: 'vRjaGgDsWSo',
        title: 'Casa Tupka Anthemo | Yo Yo Honey Singh feat. Priyanshi',
        thumbnail: 'https://i.ytimg.com/vi/vRjaGgDsWSo/hq720.jpg',
        channelTitle: 'Yo Yo Honey Singh',
        duration: '03:06',
        durationSeconds: 186,
      },
      {
        videoId: 'dQw4w9WgXcQ',
        title: 'Never Gonna Give You Up - Rick Astley',
        thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hq720.jpg',
        channelTitle: 'Rick Astley',
        duration: '03:33',
        durationSeconds: 213,
      },
    ],
  };
}

async function resolveRoom(roomId: string): Promise<any> {
  const canonical = normalizeWatchRoomId(roomId);
  const rawId = String(roomId).replace(/^room_/, '');
  const room = await Room.findOne({
    $or: [
      { channelName: canonical },
      { channelName: rawId },
      { uniqueId: rawId },
      { customDisplayId: rawId },
      ...(rawId.length === 24 ? [{ _id: rawId }] : []),
    ],
  }).populate('ownerId', 'userId name image avatar').lean();

  if (!room) throw new RoomWatchError('Voice Room not found', 404);
  return room;
}

import mongoose from 'mongoose';
import { User } from '../models/user.model';

export async function checkPermission(room: any, user: any) {
  const authUserId = String(user?.id || user?._id || '').trim();
  const numericUserId = user?.userId ? String(user.userId).trim() : '';

  if (!authUserId && !numericUserId) {
    throw new RoomWatchError('Authentication required to control video playback', 401);
  }

  const userLookup: any[] = [];
  if (authUserId && mongoose.Types.ObjectId.isValid(authUserId)) userLookup.push({ _id: authUserId });
  if (numericUserId) userLookup.push({ userId: numericUserId });

  const userDoc = userLookup.length > 0 ? await User.findOne({ $or: userLookup }).select('hasVideoAccess canWatchTogether isBlocked isDeleted role').lean() : null;

  if (!userDoc || userDoc.isBlocked || userDoc.isDeleted) {
    throw new RoomWatchError('User account not found or blocked', 403);
  }

  const hasVideoPermission = Boolean(userDoc.hasVideoAccess || (userDoc as any).canWatchTogether);
  if (!hasVideoPermission) {
    throw new RoomWatchError('Video Access Denied: You do not have permission to control or play videos. Please request permission from Admin Panel.', 403);
  }

  return { hasVideoAccess: true };
}

/**
 * Get active watch session with expected server-calculated playback time
 */
export async function getWatchSession(roomId: string): Promise<any> {
  const canonical = normalizeWatchRoomId(roomId);
  let session = await RoomWatchSession.findOne({ roomId: canonical, isActive: true }).lean();

  if (!session) {
    return {
      roomId: canonical,
      videoId: '',
      videoTitle: '',
      videoThumbnail: '',
      channelTitle: '',
      duration: '00:00',
      durationSeconds: 0,
      status: 'idle',
      currentTime: 0,
      expectedCurrentTime: 0,
      playbackRate: 1,
      lastUpdatedAt: new Date(),
      queue: [],
      isActive: false,
    };
  }

  let expectedCurrentTime = session.currentTime || 0;
  if (session.status === 'playing' && session.lastUpdatedAt) {
    const elapsed = (Date.now() - new Date(session.lastUpdatedAt).getTime()) / 1000 * (session.playbackRate || 1);
    expectedCurrentTime = session.currentTime + Math.max(0, elapsed);
    if (session.durationSeconds > 0 && expectedCurrentTime >= session.durationSeconds) {
      expectedCurrentTime = session.durationSeconds;
    }
  }

  return {
    ...session,
    expectedCurrentTime: Math.round(expectedCurrentTime * 10) / 10,
    serverTime: new Date(),
  };
}

async function broadcastWatchEvent(roomId: string, eventName: string, payload: any) {
  const io = getIOOptional();
  const canonical = normalizeWatchRoomId(roomId);
  if (io) {
    io.to(canonical).emit(eventName, payload);
    io.to(`room_${canonical.replace(/^room_/, '')}`).emit(eventName, payload);
  }
  try {
    await redis.publish('room_watch_events', JSON.stringify({ roomId: canonical, eventName, payload }));
  } catch {
    // Non-critical Redis publish
  }
}

/**
 * Select a video to watch together
 */
export async function selectVideo(roomId: string, videoData: any, user: any) {
  const room = await resolveRoom(roomId);
  await checkPermission(room, user);

  const canonical = normalizeWatchRoomId(room.channelName || roomId);
  const videoId = String(videoData?.videoId || '').trim();
  if (!videoId) throw new RoomWatchError('Valid videoId is required', 400);

  const durationStr = String(videoData?.duration || '03:45');
  const durSec = Number(videoData?.durationSeconds) || parseDurationSeconds(durationStr) || 225;

  const update = {
    roomId: canonical,
    videoId,
    videoTitle: String(videoData?.title || 'YouTube Video'),
    videoThumbnail: String(videoData?.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`),
    channelTitle: String(videoData?.channelTitle || 'YouTube Channel'),
    duration: durationStr,
    durationSeconds: durSec,
    status: 'playing',
    currentTime: 0,
    playbackRate: 1,
    lastUpdatedAt: new Date(),
    updatedBy: String(user?.userId || user?.name || 'Host'),
    hostUserId: String(room.ownerId?.userId || user?.userId || ''),
    isActive: true,
  };

  const session = await RoomWatchSession.findOneAndUpdate(
    { roomId: canonical },
    { $set: update },
    { new: true, upsert: true }
  ).lean();

  const syncState = {
    ...session,
    expectedCurrentTime: 0,
    serverTime: new Date(),
  };

  await broadcastWatchEvent(canonical, 'roomWatch:videoSelected', syncState);
  await broadcastWatchEvent(canonical, 'roomWatch:syncState', syncState);

  return syncState;
}

/**
 * Update playback state: play, pause, seek
 */
export async function updatePlayback(
  roomId: string,
  payload: { action: 'play' | 'pause' | 'seek'; currentTime?: number },
  user: any
) {
  const room = await resolveRoom(roomId);
  await checkPermission(room, user);

  const canonical = normalizeWatchRoomId(room.channelName || roomId);
  const session = await RoomWatchSession.findOne({ roomId: canonical, isActive: true });
  if (!session) throw new RoomWatchError('No active video session found in this room', 404);

  const action = payload.action;
  const time = typeof payload.currentTime === 'number' ? Math.max(0, payload.currentTime) : session.currentTime;

  if (action === 'play') {
    session.status = 'playing';
    session.currentTime = time;
    session.lastUpdatedAt = new Date();
  } else if (action === 'pause') {
    session.status = 'paused';
    session.currentTime = time;
    session.lastUpdatedAt = new Date();
  } else if (action === 'seek') {
    session.currentTime = time;
    session.lastUpdatedAt = new Date();
  } else {
    throw new RoomWatchError('Invalid playback action', 400);
  }

  session.updatedBy = String(user?.userId || user?.name || 'Host');
  await session.save();

  const syncState = {
    roomId: canonical,
    action,
    videoId: session.videoId,
    status: session.status,
    currentTime: session.currentTime,
    expectedCurrentTime: session.currentTime,
    updatedBy: session.updatedBy,
    serverTime: new Date(),
  };

  await broadcastWatchEvent(canonical, 'roomWatch:playbackUpdated', syncState);
  return syncState;
}

/**
 * Close watch together session in the room
 */
export async function closeWatchSession(roomId: string, user: any) {
  const room = await resolveRoom(roomId);
  await checkPermission(room, user);

  const canonical = normalizeWatchRoomId(room.channelName || roomId);
  await RoomWatchSession.findOneAndUpdate(
    { roomId: canonical },
    { $set: { status: 'idle', isActive: false, videoId: '' } }
  );

  const payload = { roomId: canonical, status: 'idle', isActive: false };
  await broadcastWatchEvent(canonical, 'roomWatch:sessionClosed', payload);
  return payload;
}

/**
 * Video Queue management
 */
export async function addToQueue(roomId: string, videoData: any, user: any) {
  const room = await resolveRoom(roomId);
  await checkPermission(room, user);

  const canonical = normalizeWatchRoomId(room.channelName || roomId);
  const videoId = String(videoData?.videoId || '').trim();
  if (!videoId) throw new RoomWatchError('Valid videoId is required', 400);

  const queueItem = {
    videoId,
    videoTitle: String(videoData?.title || 'YouTube Video'),
    videoThumbnail: String(videoData?.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`),
    channelTitle: String(videoData?.channelTitle || 'YouTube Channel'),
    duration: String(videoData?.duration || '00:00'),
    durationSeconds: Number(videoData?.durationSeconds || 0),
    addedBy: String(user?.userId || user?.id || 'Member'),
    addedByName: String(user?.name || 'Member'),
    addedAt: new Date(),
  };

  const session = await RoomWatchSession.findOneAndUpdate(
    { roomId: canonical, isActive: true },
    { $push: { queue: queueItem } },
    { new: true }
  ).lean();

  if (!session) throw new RoomWatchError('No active watch session to queue into', 404);
  await broadcastWatchEvent(canonical, 'roomWatch:queueUpdated', { queue: session.queue });
  return session.queue;
}

export async function removeFromQueue(roomId: string, videoId: string, user: any) {
  const room = await resolveRoom(roomId);
  await checkPermission(room, user);

  const canonical = normalizeWatchRoomId(room.channelName || roomId);
  const session = await RoomWatchSession.findOneAndUpdate(
    { roomId: canonical, isActive: true },
    { $pull: { queue: { videoId } } },
    { new: true }
  ).lean();

  if (!session) throw new RoomWatchError('No active watch session', 404);
  await broadcastWatchEvent(canonical, 'roomWatch:queueUpdated', { queue: session.queue });
  return session.queue;
}
