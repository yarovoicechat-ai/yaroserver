import { EconomyHostingMinute, EconomyHostMonth } from './models';
import { effectiveEconomy, getVersion } from './service';
import { calendarKeys, NEW_ECONOMY } from './rules';

export async function attendanceEconomy(hostId: string) {
  const active = await effectiveEconomy();
  if (active) return active;
  // Prospective rollback must not erase the chance to qualify for already-reserved salary.
  const month = calendarKeys(new Date(), NEW_ECONOMY).month;
  const obligation = await EconomyHostMonth.findOne({ hostId, month, settled: false }).lean();
  return obligation ? getVersion(obligation.version) : null;
}

/** Server-side observations only. Deduplicates overlapping rooms/devices by UTC minute. */
export async function recordObservedHostingMinute(hostId: string, roomId: string, minute: number, expectedVersion: string) {
  const economy = await attendanceEconomy(hostId);
  if (!economy || economy.version !== expectedVersion) return;
  if (!Number.isSafeInteger(minute) || minute !== Math.floor(Date.now() / 60000) - 1) throw new Error('Only a completed server-observed minute can count');
  await EconomyHostingMinute.updateOne({ hostId, minute }, { $setOnInsert: { roomId, version: economy.version } }, { upsert: true });
}

/** Gaps, room/version changes or inactive seats reset observation. Under-counting is intentional. */
export class HostingObserver {
  private start = 0;
  private last = 0;
  private room = '';
  private version = '';
  observe(now: number, room: string, version: string, valid: boolean): number | null {
    if (!valid) { this.start = this.last = 0; return null; }
    if (!this.last || now - this.last > 20000 || now <= this.last || this.room !== room || this.version !== version) {
      this.start = this.last = now; this.room = room; this.version = version; return null;
    }
    const previousMinute = Math.floor(now / 60000) - 1;
    const completed = Math.floor(this.last / 60000) !== Math.floor(now / 60000) && this.start <= previousMinute * 60000;
    this.last = now;
    return completed ? previousMinute : null;
  }
}
