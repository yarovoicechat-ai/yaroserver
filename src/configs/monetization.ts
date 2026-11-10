/**
 * Authoritative money/coin rules.
 * Keep financial rules server-side so clients cannot change payout math.
 */
export const CALL_DIAMONDS_PER_MINUTE = 600;
export const CALL_COINS_PER_MINUTE_VOICE = 600;
export const CALL_COINS_PER_MINUTE_VIDEO = 1200;
export const WITHDRAWAL_COINS_PER_INR = 200; // 200 Beans = ₹1
export const MIN_WITHDRAWAL_INR = 10;
export const WITHDRAWAL_PLATFORM_FEE_PERCENT = 5;
export const MIN_WITHDRAWAL_COINS =
  WITHDRAWAL_COINS_PER_INR * MIN_WITHDRAWAL_INR;

export const HOST_LEVEL_COINS_PER_MINUTE: Record<number, number> = {
  1: 500,
  2: 500,
  3: 500,
  4: 500,
  5: 500,
  6: 500,
  7: 500,
  8: 500,
};
