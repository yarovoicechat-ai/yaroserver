import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEW_ECONOMY as rules, validateRules, diamondUnits, diamondDisplay, giftAllocation, salaryQuote, withdrawalQuote,
  assertBalanced, mul, ratio, calendarKeys } from '../economy/rules';

test('target voice and video rates use exact integer units', () => {
  assert.deepEqual(rules.voice, { diamondUnitsPerMinute: 492, hostBeansPerMinute: 205, referencePaisePerMinute: 600 });
  assert.deepEqual(rules.video, { diamondUnitsPerMinute: 984, hostBeansPerMinute: 410, referencePaisePerMinute: 1200 });
  assert.equal(mul(1000, rules.voice.diamondUnitsPerMinute), 492000);
  assert.equal(diamondUnits(4.92), 492); assert.equal(diamondDisplay(984), 9.84);
});
test('100 Diamond room gift reconciles all four allocations', () => {
  const p = giftAllocation(10000, rules, 1000);
  assert.deepEqual(p, { baseBeans: 10000, instant: 4500, salaryReserve: 1500, agency: 1000, platform: 3000 });
  assert.equal(p.instant + p.salaryReserve + p.agency + p.platform, p.baseBeans);
  const noAgency = giftAllocation(10000, rules);
  assert.equal(noAgency.platform, 4000);
});
test('small gifts and rounding always conserve reference Beans and platform floor', () => {
  for (let units = 1; units < 10000; units++) {
    const p = giftAllocation(units, rules, 1000);
    assert.equal(p.instant + p.salaryReserve + p.agency + p.platform, units);
    assert.ok(p.platform >= ratio(units, 3000, 10000, true));
  }
});
const days = Object.fromEntries(Array.from({ length: 15 }, (_, n) => [`2026-09-${String(n + 1).padStart(2, '0')}`, 120]));
test('salary slab boundaries and all eligibility gates', () => {
  const boundaries = [[24999, 0], [25000, 300], [49999, 300], [50000, 600], [99999, 600], [100000, 800],
    [199999, 800], [200000, 1000], [499999, 1000], [500000, 1200], [999999, 1200], [1000000, 1500]];
  for (const [diamonds, bps] of boundaries) assert.equal(salaryQuote(diamonds * 100, days, rules).bps, bps);
  const fourteen = { ...days }; delete fourteen['2026-09-15'];
  assert.equal(salaryQuote(100000000, fourteen, rules).bps, 0);
  assert.equal(salaryQuote(100000000, Object.fromEntries(Object.keys(days).map(d => [d, 60])), rules).bps, 0);
  const shortDay = { ...days, '2026-09-15': 59, '2026-09-01': 500 };
  assert.equal(salaryQuote(100000000, shortDay, rules).eligible, false);
  assert.equal(salaryQuote(100000000, days, rules).beans, 15000000);
});
test('withdrawal uses 82 Beans/INR and conserves fractional-paise remainder', () => {
  assert.equal(withdrawalQuote(82, rules).grossPaise, 100);
  assert.deepEqual(withdrawalQuote(16400, rules), { grossPaise: 20000, feePaise: 1000, netPaise: 19000, beansToHold: 16400, beansRemainder: 0 });
  for (let beans = 1; beans < 500; beans++) {
    const q = withdrawalQuote(beans, rules);
    assert.equal(q.beansToHold + q.beansRemainder, beans); assert.ok(q.netPaise + q.feePaise === q.grossPaise);
  }
});
test('invalid distributions, salary rules, unsafe amounts and legacy drift fail closed', () => {
  assert.doesNotThrow(() => validateRules(structuredClone(rules)));
  const bad = structuredClone(rules); bad.gift.agencyMaxBps = 1001; assert.throws(() => validateRules(bad));
  const salary = structuredClone(rules); salary.salary.minDays = 14; assert.throws(() => validateRules(salary));
  const slabs = structuredClone(rules); slabs.salary.slabs[1].bps = 1600; assert.throws(() => validateRules(slabs));
  for (const n of [NaN, Infinity, -1, 0.1 + 0.2]) assert.throws(() => diamondUnits(n));
  assert.throws(() => mul(Number.MAX_SAFE_INTEGER, 2));
  assert.throws(() => giftAllocation(10000, rules, 1001));
});
test('journals reconcile each currency separately', () => {
  assert.doesNotThrow(() => assertBalanced([{ account: 'a', asset: 'BEAN', delta: -205 }, { account: 'b', asset: 'BEAN', delta: 205 }]));
  assert.throws(() => assertBalanced([{ account: 'a', asset: 'DIAMOND_UNIT', delta: -100 }, { account: 'b', asset: 'BEAN', delta: 100 }]));
});
test('salary calendar uses Asia/Calcutta month boundaries', () => {
  assert.deepEqual(calendarKeys(new Date('2026-09-30T18:30:00Z'), rules), { month: '2026-10', day: '2026-10-01' });
});
