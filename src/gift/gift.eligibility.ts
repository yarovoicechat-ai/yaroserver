export const canSendVipGift = (user: { wealthLevel?: number; level?: number }) =>
  Number(user.wealthLevel ?? user.level ?? 1) >= 5;
