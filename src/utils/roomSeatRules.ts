export interface SeatAllocationResult<TState> {
  state: TState;
  seatIndex: number;
}

export const ROOM_SEAT_COUNTS = [8, 10, 12, 14, 15, 17, 18, 20, 24, 26];
export const validateRoomSeatCount = (value: unknown): number => {
  const count = Number(value);
  if (!ROOM_SEAT_COUNTS.includes(count)) throw new Error('Choose a valid room seat count (12, 17, 20, 26)');
  return count;
};

export const getSeatTotals = (count: number) => {
  if (count === 12) return { totalCount: 12, topCount: 2, bottomCount: 10, seatsPerRow: 5 };
  if (count === 17) return { totalCount: 17, topCount: 2, bottomCount: 15, seatsPerRow: 5 };
  if (count === 20) return { totalCount: 20, topCount: 2, bottomCount: 18, seatsPerRow: 6 };
  if (count === 26) return { totalCount: 26, topCount: 2, bottomCount: 24, seatsPerRow: 6 };
  if (count === 10) return { totalCount: 12, topCount: 2, bottomCount: 10, seatsPerRow: 5 };
  if (count === 15) return { totalCount: 17, topCount: 2, bottomCount: 15, seatsPerRow: 5 };
  if (count === 18) return { totalCount: 20, topCount: 2, bottomCount: 18, seatsPerRow: 6 };
  if (count === 24) return { totalCount: 26, topCount: 2, bottomCount: 24, seatsPerRow: 6 };
  return { totalCount: count <= 8 ? count + 2 : count, topCount: 2, bottomCount: count <= 8 ? count : count - 2, seatsPerRow: count >= 20 ? 6 : (count > 10 ? 5 : 4) };
};

// Keep existing positions where possible; relocate occupied removed seats
// before shrinking, and reject layouts that cannot retain every occupant.
export const resizeRoomSeats = <T extends { seats: any[]; seatCount?: number }>(state: T, value: unknown): T => {
  const count = validateRoomSeatCount(value);
  const { totalCount } = getSeatTotals(count);
  const seats = Array.from({ length: totalCount }, (_, index) => ({
    seatIndex: index, isHost: index === 0, user: null, isMuted: true, isLocked: false,
    ...state.seats?.[index],
  }));
  const displaced = (state.seats || []).slice(totalCount).filter(seat => seat.user);
  for (const oldSeat of displaced) {
    const target = seats.findIndex((seat, index) => index > 1 && !seat.user && !seat.isLocked);
    if (target < 0) throw new Error('Not enough empty seats. Ask users to leave a mic before reducing the layout.');
    seats[target] = { ...oldSeat, seatIndex: target, isHost: false };
  }
  return { ...state, seats, seatCount: count };
};

export const allocateRoomSeat = <TState extends { seats: any[] }>(
  state: TState,
  seatIndex: number,
  user: any,
  isMuted = true,
): SeatAllocationResult<TState> => {
  if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= state.seats.length) {
    throw new Error('Invalid seat number');
  }

  const userId = String(user?.userId || user?._id || user?.id || '');
  if (!userId) throw new Error('Authenticated room user is required');

  const targetSeat = state.seats[seatIndex];
  if (targetSeat.isLocked) throw new Error('This seat is locked by host');
  if (targetSeat.user && String(targetSeat.user.userId || targetSeat.user._id || targetSeat.user.id) !== userId) {
    throw new Error('Seat already taken');
  }

  // Moving seats or receiving a duplicate take-seat event must not reset the
  // speaker's microphone. The default only applies when joining from audience.
  const previousSeat = state.seats.find(seat =>
    String(seat.user?.userId || seat.user?._id || seat.user?.id || '') === userId,
  );
  const nextMuted = previousSeat ? Boolean(previousSeat.isMuted) : isMuted;

  const seats = state.seats.map((seat) => {
    const occupantId = String(seat.user?.userId || seat.user?._id || seat.user?.id || '');
    if (occupantId === userId) return { ...seat, user: null, isMuted: true };
    return { ...seat };
  });

  seats[seatIndex] = {
    ...seats[seatIndex],
    user,
    isMuted: nextMuted,
    isLocked: false,
  };

  return { state: { ...state, seats }, seatIndex };
};
