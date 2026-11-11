// App Coins are stored in diamonds; earned Beans are stored in coins.
export const GIFT_RECEIVER_PERCENT = 45;
export const GIFT_COMMISSION_PERCENT = 100 - GIFT_RECEIVER_PERCENT;

export const giftSettlement = (spentCoins: number) => {
  if (!Number.isSafeInteger(spentCoins) || spentCoins < 0) throw new Error('Invalid gift coin amount');
  const receiverBeans = Number(BigInt(spentCoins) * BigInt(GIFT_RECEIVER_PERCENT) / 100n);
  return { receiverBeans, platformCoins: spentCoins - receiverBeans };
};
