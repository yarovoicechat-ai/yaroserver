export const ROOM_PK_DURATION_MS = 5 * 60 * 1000;
export const ROOM_PK_INVITE_MS = 60 * 1000;
export const ROOM_PK_SETTLE_MS = 1500;

export const normalizePKRoomId = (value: unknown) => {
  const id = String(value || '').trim();
  return /^10000\d{3}$/.test(id) ? `100000000${id.slice(5)}`.slice(-10) : id;
};

export const roomPKResult = (roomIds: string[], scores: number[]) => {
  if (roomIds.length !== 2 || scores.length !== 2 || roomIds[0] === roomIds[1] ||
      scores.some(score => !Number.isSafeInteger(score) || score < 0)) throw new Error('Invalid PK result');
  const draw = scores[0] === scores[1];
  return { draw, winnerRoomId: draw ? null : roomIds[scores[0] > scores[1] ? 0 : 1],
    loserRoomId: draw ? null : roomIds[scores[0] > scores[1] ? 1 : 0] };
};

export const isPKGiftInWindow = (createdAt: Date, startedAt: Date, endsAt: Date) =>
  createdAt.getTime() >= startedAt.getTime() && createdAt.getTime() < endsAt.getTime();
