export interface SeatAllocationResult<TState> {
  state: TState;
  seatIndex: number;
}

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
