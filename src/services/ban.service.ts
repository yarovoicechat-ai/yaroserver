import { User } from '../models/user.model';
import { Device } from '../models/device.model';
import { BanHistory } from '../models/banHistory.model';

export function calculateBannedUntil(duration: string, customDate?: string | Date): Date | null {
  const norm = String(duration || '').trim().toLowerCase();
  const now = Date.now();

  if (norm.includes('permanent')) return null;

  if (norm.includes('1 hour') || norm === '1h') return new Date(now + 60 * 60 * 1000);
  if (norm.includes('6 hour') || norm === '6h') return new Date(now + 6 * 60 * 60 * 1000);
  if (norm.includes('12 hour') || norm === '12h') return new Date(now + 12 * 60 * 60 * 1000);
  if (norm.includes('24 hour') || norm.includes('1 day') || norm === '24h' || norm === '1d') return new Date(now + 24 * 60 * 60 * 1000);
  if (norm.includes('3 day') || norm === '3d') return new Date(now + 3 * 24 * 60 * 60 * 1000);
  if (norm.includes('7 day') || norm.includes('1 week') || norm === '7d') return new Date(now + 7 * 24 * 60 * 60 * 1000);
  if (norm.includes('15 day') || norm === '15d') return new Date(now + 15 * 24 * 60 * 60 * 1000);
  if (norm.includes('30 day') || norm.includes('1 month') || norm === '30d') return new Date(now + 30 * 24 * 60 * 60 * 1000);
  if (norm.includes('90 day') || norm.includes('3 month') || norm === '90d') return new Date(now + 90 * 24 * 60 * 60 * 1000);

  if (customDate) {
    const parsed = new Date(customDate);
    if (!isNaN(parsed.getTime()) && parsed.getTime() > now) {
      return parsed;
    }
  }

  // Fallback default: 24 hours if temporary was requested without valid duration
  return new Date(now + 24 * 60 * 60 * 1000);
}

export function getRemainingTimeString(bannedUntil?: Date | null): string {
  if (!bannedUntil) return 'Permanent';
  const diffMs = new Date(bannedUntil).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';

  const totalMinutes = Math.floor(diffMs / (60 * 1000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hr${hours > 1 ? 's' : ''}`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} min${minutes !== 1 ? 's' : ''}`);

  return parts.join(', ');
}

export async function checkUserBanStatus(user: any): Promise<{ isBanned: boolean; banInfo?: any }> {
  if (!user) return { isBanned: false };

  const isMarkedBanned = Boolean(user.isBanned || user.isBlocked);
  if (!isMarkedBanned) return { isBanned: false };

  const banType = user.banType || (user.bannedUntil ? 'temporary' : 'permanent');

  // Handle temporary ban auto-expiry
  if (banType === 'temporary') {
    if (user.bannedUntil && new Date(user.bannedUntil).getTime() <= Date.now()) {
      // Ban has expired! Restore user automatically
      user.isBanned = false;
      user.isBlocked = false;
      user.banType = null;
      user.bannedUntil = null;
      user.adminNote = user.adminNote ? `${user.adminNote} [Auto-expired at ${new Date().toISOString()}]` : 'Auto-expired';
      try {
        await user.save();
        await BanHistory.create({
          targetType: 'USER',
          targetId: String(user.userId || user._id),
          action: 'AUTO_EXPIRE',
          banType: 'temporary',
          reason: 'Temporary ban duration expired',
          adminNote: 'System automated expiry check',
          createdAt: new Date(),
        });
      } catch (err: any) {
        console.warn('[BanService] Auto-expire user save failed:', err?.message);
      }
      return { isBanned: false };
    }
  }

  return {
    isBanned: true,
    banInfo: {
      banType,
      banReason: user.banReason || 'Your account has been suspended by platform administration.',
      bannedAt: user.bannedAt || new Date(),
      bannedUntil: user.bannedUntil || null,
    },
  };
}

export async function checkDeviceBanStatus(deviceId?: string | null): Promise<{ isBanned: boolean; banInfo?: any }> {
  const cleanId = String(deviceId || '').trim();
  if (!cleanId) return { isBanned: false };

  const device = await Device.findOne({ deviceId: cleanId });
  if (!device || !device.isBanned) return { isBanned: false };

  const banType = device.banType || (device.bannedUntil ? 'temporary' : 'permanent');

  // Handle temporary device ban auto-expiry
  if (banType === 'temporary') {
    if (device.bannedUntil && new Date(device.bannedUntil).getTime() <= Date.now()) {
      device.isBanned = false;
      device.banType = null;
      device.bannedUntil = null;
      device.adminNote = device.adminNote ? `${device.adminNote} [Auto-expired at ${new Date().toISOString()}]` : 'Auto-expired';
      try {
        await device.save();
        await BanHistory.create({
          targetType: 'DEVICE',
          targetId: cleanId,
          action: 'AUTO_EXPIRE',
          banType: 'temporary',
          reason: 'Temporary device ban duration expired',
          adminNote: 'System automated expiry check',
          createdAt: new Date(),
        });
      } catch (err: any) {
        console.warn('[BanService] Auto-expire device save failed:', err?.message);
      }
      return { isBanned: false };
    }
  }

  return {
    isBanned: true,
    banInfo: {
      banType,
      banReason: device.banReason || 'This device has been suspended by platform administration.',
      bannedAt: device.bannedAt || new Date(),
      bannedUntil: device.bannedUntil || null,
      deviceId: cleanId,
    },
  };
}

export function formatBanPayload(banInfo: any, targetType: 'USER' | 'DEVICE') {
  return {
    errorCode: targetType === 'DEVICE' ? 'DEVICE_BANNED' : 'ACCOUNT_BANNED',
    targetType,
    banType: banInfo.banType || 'permanent',
    reason: banInfo.banReason || (targetType === 'DEVICE' ? 'This device has been restricted by administration.' : 'Your account has been restricted by administration.'),
    bannedAt: banInfo.bannedAt ? new Date(banInfo.bannedAt).toISOString() : new Date().toISOString(),
    bannedUntil: banInfo.bannedUntil ? new Date(banInfo.bannedUntil).toISOString() : null,
    remainingTime: getRemainingTimeString(banInfo.bannedUntil ? new Date(banInfo.bannedUntil) : null),
  };
}

export async function syncDeviceRecord(
  deviceId: string,
  userId?: number,
  platform?: string,
  appVersion?: string
): Promise<void> {
  const cleanId = String(deviceId || '').trim();
  if (!cleanId) return;

  try {
    const update: any = {
      $set: {
        lastSeenAt: new Date(),
        ...(platform ? { platform } : {}),
        ...(appVersion ? { appVersion } : {}),
      },
      $setOnInsert: {
        firstSeenAt: new Date(),
        isBanned: false,
      },
    };

    if (userId && typeof userId === 'number') {
      update.$addToSet = { associatedUserIds: userId };
    }

    await Device.updateOne({ deviceId: cleanId }, update, { upsert: true });
  } catch (err: any) {
    console.warn('[BanService] Sync device record failed:', err?.message);
  }
}
