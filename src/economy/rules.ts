/** V2 uses integer hundredths of a Diamond, whole Beans, paise and basis points. */
export interface EconomyRules {
  beansPerInr: number;
  giftBeansPerDiamond: number;
  voice: { diamondUnitsPerMinute: number; hostBeansPerMinute: number; referencePaisePerMinute: number };
  video: { diamondUnitsPerMinute: number; hostBeansPerMinute: number; referencePaisePerMinute: number };
  gift: { instantBps: number; salaryMaxBps: number; agencyMaxBps: number; platformMinBps: number };
  salary: { minDays: number; minHostingMinutes: number; minDayMinutes: number;
    slabs: Array<{ diamonds: number; bps: number }> };
  withdrawal: { minimumPaise: number; feeBps: number };
  calendarOffsetMinutes: number;
}
export const NEW_ECONOMY: EconomyRules = {
  beansPerInr: 82, giftBeansPerDiamond: 100,
  voice: { diamondUnitsPerMinute: 492, hostBeansPerMinute: 205, referencePaisePerMinute: 600 },
  video: { diamondUnitsPerMinute: 984, hostBeansPerMinute: 410, referencePaisePerMinute: 1200 },
  gift: { instantBps: 4500, salaryMaxBps: 1500, agencyMaxBps: 1000, platformMinBps: 3000 },
  salary: { minDays: 15, minHostingMinutes: 1800, minDayMinutes: 60,
    slabs: [{ diamonds: 0, bps: 0 }, { diamonds: 25000, bps: 300 },
      { diamonds: 50000, bps: 600 }, { diamonds: 100000, bps: 800 },
      { diamonds: 200000, bps: 1000 }, { diamonds: 500000, bps: 1200 },
      { diamonds: 1000000, bps: 1500 }] },
  withdrawal: { minimumPaise: 20000, feeBps: 500 }, calendarOffsetMinutes: 330,
};
export function integer(n: number, name = 'amount'): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} must be a nonnegative safe integer`);
  return n;
}
export function safe(n: bigint): number {
  if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Financial integer overflow');
  return Number(n);
}
export const sum = (a: number, b: number) => safe(BigInt(integer(a)) + BigInt(integer(b)));
export const mul = (a: number, b: number) => safe(BigInt(integer(a)) * BigInt(integer(b)));
export const ratio = (n: number, numerator: number, denominator: number, ceil = false) => {
  integer(n); integer(numerator); integer(denominator);
  if (!denominator) throw new Error('Zero denominator');
  const product = BigInt(n) * BigInt(numerator), divisor = BigInt(denominator);
  return safe((product + (ceil ? divisor - 1n : 0n)) / divisor);
};
/** Reject legacy fractional/drifted balances instead of rounding or rewriting them. */
export function diamondUnits(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid legacy Diamond balance');
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Diamond balance needs reconciliation before V2 use');
  const [whole, fraction = ''] = text.split('.');
  return safe(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
}
export function diamondDisplay(units: number): number {
  integer(units); const value = units / 100;
  if (diamondUnits(value) !== units) throw new Error('Diamond display range exceeded');
  return value;
}
export function validateRules(r: EconomyRules): EconomyRules {
  if (!r || typeof r !== 'object') throw new Error('Economy rules required');
  integer(r.beansPerInr); integer(r.giftBeansPerDiamond);
  if (!r.beansPerInr || !r.giftBeansPerDiamond) throw new Error('Conversion rates must be positive');
  for (const call of [r.voice, r.video]) {
    integer(call.diamondUnitsPerMinute); integer(call.hostBeansPerMinute); integer(call.referencePaisePerMinute);
    if (!call.diamondUnitsPerMinute) throw new Error('Call price must be positive');
    if (call.hostBeansPerMinute > ratio(call.referencePaisePerMinute, r.beansPerInr, 100)) throw new Error('Call host earnings exceed reference revenue');
  }
  const g = r.gift;
  Object.values(g).forEach(n => integer(n));
  if (g.instantBps > 4500 || g.salaryMaxBps > 1500 || g.agencyMaxBps > 1000 || g.platformMinBps < 3000 ||
    g.instantBps + g.salaryMaxBps + g.agencyMaxBps + g.platformMinBps > 10000) throw new Error('Gift distribution exceeds approved caps');
  const s = r.salary;
  [s.minDays, s.minHostingMinutes, s.minDayMinutes].forEach(n => integer(n));
  if (s.minDays < 15 || s.minHostingMinutes < 1800 || s.minDayMinutes < 60) throw new Error('Salary eligibility cannot be weakened');
  if (!Array.isArray(s.slabs) || !s.slabs.length || s.slabs[0].diamonds !== 0 || s.slabs[0].bps !== 0) throw new Error('Salary zero slab required');
  let threshold = -1, bps = -1;
  for (const slab of s.slabs) {
    integer(slab.diamonds); integer(slab.bps);
    if (slab.diamonds <= threshold || slab.bps < bps || slab.bps > g.salaryMaxBps) throw new Error('Invalid salary slab ordering/cap');
    threshold = slab.diamonds; bps = slab.bps;
  }
  integer(r.withdrawal.minimumPaise); integer(r.withdrawal.feeBps);
  if (r.withdrawal.feeBps > 10000) throw new Error('Invalid withdrawal fee');
  if (r.calendarOffsetMinutes !== 330) throw new Error('Invalid calendar offset');
  return r;
}
export function giftAllocation(units: number, r: EconomyRules, agencyBps = 0) {
  integer(units); integer(agencyBps);
  if (agencyBps > r.gift.agencyMaxBps) throw new Error('Agency commission above cap');
  const baseBeans = ratio(units, r.giftBeansPerDiamond, 100);
  const instant = ratio(baseBeans, r.gift.instantBps, 10000);
  const salaryReserve = ratio(baseBeans, r.gift.salaryMaxBps, 10000);
  const agency = ratio(baseBeans, agencyBps, 10000);
  const platform = baseBeans - instant - salaryReserve - agency;
  if (platform < ratio(baseBeans, r.gift.platformMinBps, 10000, true)) throw new Error('Platform minimum not funded');
  return { baseBeans, instant, salaryReserve, agency, platform };
}
export function salaryQuote(monthlyUnits: number, dailyMinutes: Record<string, number>, r: EconomyRules) {
  integer(monthlyUnits);
  const minutes = Object.values(dailyMinutes).map(n => integer(n));
  if (minutes.some(n => n > 1440)) throw new Error('Overlapping hosting evidence');
  const activeDays = minutes.filter(n => n >= r.salary.minDayMinutes).length;
  const hostingMinutes = minutes.reduce((a, b) => sum(a, b), 0);
  const eligible = activeDays >= r.salary.minDays && hostingMinutes >= r.salary.minHostingMinutes;
  let bps = 0;
  if (eligible) for (const slab of r.salary.slabs) if (monthlyUnits >= mul(slab.diamonds, 100)) bps = slab.bps;
  return { eligible, activeDays, hostingMinutes, bps,
    beans: ratio(ratio(monthlyUnits, r.giftBeansPerDiamond, 100), bps, 10000) };
}
export function withdrawalQuote(beans: number, r: EconomyRules) {
  integer(beans);
  const grossPaise = ratio(beans, 100, r.beansPerInr);
  const feePaise = ratio(grossPaise, r.withdrawal.feeBps, 10000);
  // Keep any fractional-paise Beans in the wallet rather than silently burning them.
  const beansToHold = ratio(grossPaise, r.beansPerInr, 100, true);
  return { grossPaise, feePaise, netPaise: grossPaise - feePaise, beansToHold, beansRemainder: beans - beansToHold };
}
export function calendarKeys(now: Date, r: EconomyRules) {
  const day = new Date(now.getTime() + r.calendarOffsetMinutes * 60000).toISOString().slice(0, 10);
  return { day, month: day.slice(0, 7) };
}
export interface Posting { account: string; asset: 'DIAMOND_UNIT' | 'BEAN'; delta: number }
export function assertBalanced(postings: Posting[]) {
  const totals: Record<string, bigint> = {};
  for (const p of postings) {
    if (!p.account || !Number.isSafeInteger(p.delta)) throw new Error('Invalid journal posting');
    totals[p.asset] = (totals[p.asset] || 0n) + BigInt(p.delta);
  }
  if (Object.values(totals).some(n => n !== 0n)) throw new Error('Journal does not reconcile');
}
