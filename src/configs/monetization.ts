/**
 * Authoritative money/coin rules.
 * Keep financial rules server-side so clients cannot change payout math.
 */
export const CALL_DIAMONDS_PER_MINUTE = 600;
export const CALL_COINS_PER_MINUTE_VOICE = 600;
export const CALL_COINS_PER_MINUTE_VIDEO = 1200;
export const WITHDRAWAL_COINS_PER_INR = 100;
export const MIN_WITHDRAWAL_INR = 200;
export const WITHDRAWAL_PLATFORM_FEE_PERCENT = 5;
export const MIN_WITHDRAWAL_COINS =
  WITHDRAWAL_COINS_PER_INR * MIN_WITHDRAWAL_INR;

export const HOST_LEVEL_COINS_PER_MINUTE: Record<number, number> = {
  1: 250,
  2: 250,
  3: 250,
  4: 250,
  5: 250,
  6: 250,
  7: 250,
  8: 250,
};
