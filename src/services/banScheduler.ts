import { User } from '../models/user.model';
import { Device } from '../models/device.model';
import { BanHistory } from '../models/banHistory.model';

let schedulerInterval: NodeJS.Timeout | null = null;

export async function processExpiredBans(): Promise<{ usersExpired: number; devicesExpired: number }> {
  const now = new Date();
  let usersExpired = 0;
  let devicesExpired = 0;

  try {
    // 1. Process expired Users
    const expiredUsers = await User.find({
      isBanned: true,
      banType: 'temporary',
      bannedUntil: { $ne: null, $lte: now },
    }).select('_id userId bannedUntil');

    for (const u of expiredUsers) {
      await User.updateOne(
        { _id: u._id },
        {
          $set: {
            isBanned: false,
            isBlocked: false,
            banType: null,
            bannedUntil: null,
          },
        }
      );

      await BanHistory.create({
        targetType: 'USER',
        targetId: String(u.userId || u._id),
        action: 'AUTO_EXPIRE',
        banType: 'temporary',
        reason: 'Temporary ban expired via scheduled check',
        adminNote: 'Periodic ban scheduler auto-expiration',
        createdAt: new Date(),
      });
      usersExpired++;
    }

    // 2. Process expired Devices
    const expiredDevices = await Device.find({
      isBanned: true,
      banType: 'temporary',
      bannedUntil: { $ne: null, $lte: now },
    }).select('_id deviceId bannedUntil');

    for (const d of expiredDevices) {
      await Device.updateOne(
        { _id: d._id },
        {
          $set: {
            isBanned: false,
            banType: null,
            bannedUntil: null,
          },
        }
      );

      await BanHistory.create({
        targetType: 'DEVICE',
        targetId: d.deviceId,
        action: 'AUTO_EXPIRE',
        banType: 'temporary',
        reason: 'Temporary device ban expired via scheduled check',
        adminNote: 'Periodic ban scheduler auto-expiration',
        createdAt: new Date(),
      });
      devicesExpired++;
    }
  } catch (err: any) {
    console.error('[BanScheduler] Error processing expired bans:', err?.message);
  }

  return { usersExpired, devicesExpired };
}

export function startBanScheduler(intervalMs: number = 60000): void {
  if (schedulerInterval) return;
  // Run once immediately on start
  processExpiredBans().catch(() => {});
  schedulerInterval = setInterval(() => {
    processExpiredBans().catch(() => {});
  }, intervalMs);
}

export function stopBanScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
