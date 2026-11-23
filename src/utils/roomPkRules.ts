export const ROOM_PK_DURATION_MS = 5 * 60 * 1000;
export const ROOM_PK_INVITE_MS = 60 * 1000;
export const ROOM_PK_SETTLE_MS = 1500;

export const normalizePKRoomId = (value: unknown) => {
  const id = String(value || '').trim();
  return /^10000\d{3}$/.test(id) ? `100000000${id.slice(5)}`.slice(-10) : id;
};

export const roomPKResult = (roomIds: string[], scores: number[]) => {
  if (scores.length !== 2 || scores.some(score => !Number.isSafeInteger(score) || score < 0)) throw new Error('Invalid PK result');
  const draw = scores[0] === scores[1];
  const winnerSide = draw ? null : (scores[0] > scores[1] ? 0 : 1);
  const loserSide = draw ? null : (scores[0] > scores[1] ? 1 : 0);
  const winnerRoomId = draw ? null : (roomIds[winnerSide!] || roomIds[0]);
  const loserRoomId = draw ? null : (roomIds[loserSide!] || roomIds[1] || roomIds[0]);
  return { draw, winnerSide, winnerRoomId, loserRoomId };
};

export const isPKGiftInWindow = (createdAt: Date, startedAt: Date, endsAt: Date) =>
  createdAt.getTime() >= startedAt.getTime() && createdAt.getTime() < endsAt.getTime();
