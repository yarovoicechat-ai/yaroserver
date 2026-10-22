interface RoomVoiceSeat {
  isMuted: boolean;
  user: { userId?: string | number | null } | null;
}

interface RoomVoiceAuthorizationInput {
  userId: string;
  numericUserId: string;
  roomOwnerId?: string | null;
  roomChannelName?: string | null;
  requestedRoomId: string;
  seats: RoomVoiceSeat[];
}

const matchesIdentity = (candidate: unknown, identities: string[]) =>
  Boolean(candidate && identities.includes(normalizeRoomIdentity(candidate)));

const normalizeRoomIdentity = (value: unknown): string => {
  const clean = String(value || '').trim();
  if (/^10000\d{3}$/.test(clean)) return `100000000${clean.slice(5)}`.slice(-10);
  return clean;
};

export const hasRoomVoicePublisherAccess = ({
  userId,
  numericUserId,
  roomOwnerId,
  roomChannelName,
  requestedRoomId,
  seats,
}: RoomVoiceAuthorizationInput): boolean => {
  const identities = [userId, numericUserId].filter(Boolean).map(normalizeRoomIdentity);
  const isOwner = matchesIdentity(roomOwnerId, identities) || Boolean(
    numericUserId && normalizeRoomIdentity(roomChannelName || requestedRoomId) === normalizeRoomIdentity(numericUserId),
  );
  const isSeated = seats.some((seat) =>
    Boolean(seat.user && matchesIdentity(seat.user.userId, identities)),
  );
  return isOwner || isSeated;
};
