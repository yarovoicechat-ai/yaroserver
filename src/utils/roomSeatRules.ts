export interface SeatAllocationResult<TState> {
  state: TState;
  seatIndex: number;
}

export const ROOM_SEAT_COUNTS = [8, 10, 12, 15, 17];
export const validateRoomSeatCount = (value: unknown): number => {
  const count = Number(value);
  if (!ROOM_SEAT_COUNTS.includes(count)) throw new Error('Choose a valid room seat count');
  return count;
};

// Keep existing positions where possible; relocate occupied removed seats
// before shrinking, and reject layouts that cannot retain every occupant.
export const resizeRoomSeats = <T extends { seats: any[]; seatCount?: number }>(state: T, value: unknown): T => {
  const count = validateRoomSeatCount(value);
  const seats = Array.from({ length: count }, (_, index) => ({
    seatIndex: index, isHost: index === 0, user: null, isMuted: true, isLocked: false,
    ...state.seats[index],
  }));
  const displaced = state.seats.slice(count).filter(seat => seat.user);
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

  const seats = state.seats.map((seat) => {
    const occupantId = String(seat.user?.userId || seat.user?._id || seat.user?.id || '');
    if (occupantId === userId) return { ...seat, user: null, isMuted: true };
    return { ...seat };
  });

  seats[seatIndex] = {
    ...seats[seatIndex],
    user,
    isMuted,
    isLocked: false,
  };

  return { state: { ...state, seats }, seatIndex };
};
