export const explicitRoomPowers = (account: any) => {
  const assigned = account?.officialPowers || {};
  const manager = account?.isGlobalRoomManager === true || assigned.isGlobalRoomManager === true;
  return {
    isGlobalRoomManager: manager,
    canBanRoom: manager || assigned.canBanRoom === true,
    canBanUser: manager || assigned.canBanUser === true,
    canGhostEntry: manager || assigned.canGhostEntry === true,
    canKickAnyUser: manager || assigned.canKickAnyUser === true,
    canMuteAnyUser: manager || assigned.canMuteAnyUser === true,
    canLockAnySeat: manager || assigned.canLockAnySeat === true,
  };
};
