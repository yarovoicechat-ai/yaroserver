import { EconomyRules, integer, mul, ratio } from './rules';

/** Report reference values, never label Diamond consumption as provider-paid cash revenue. */
export function callReferenceAmounts(group: {
  totalCoins: number; totalHostEarnings: number; fundedMinutes: number; video: boolean;
}, rules: EconomyRules | null) {
  if (!rules) return {
    revenueInr: group.totalCoins * 0.10,
    hostEarningsInr: group.totalHostEarnings * 0.10,
    basis: 'legacy_dashboard_reference' as const,
  };
  const rate = group.video ? rules.video : rules.voice;
  const revenuePaise = mul(integer(group.fundedMinutes), rate.referencePaisePerMinute);
  const hostPaise = ratio(integer(group.totalHostEarnings), 100, rules.beansPerInr);
  return { revenueInr: revenuePaise / 100, hostEarningsInr: hostPaise / 100, basis: 'versioned_reference' as const };
}
