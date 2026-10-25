import { getIOOptional } from '../sockets';
import { IdentityResolverService } from './identityResolver.service';

export async function publishNameEffectUpdate(userOrId: any) {
  try {
    const identity = await IdentityResolverService.resolveEffectiveIdentity(userOrId);
    const io = getIOOptional();
    if (!identity || !io) return;
    const keys = new Set([String(identity.userId), String(identity.userObjectId)]);
    const payload = { userId: identity.userId, userObjectId: identity.userObjectId, nameEffect: identity.nameEffect };
    const sockets = await io.in('user:' + identity.userObjectId).fetchSockets();
    const rooms = new Set<string>(['user:' + identity.userObjectId, 'user:' + identity.userId]);
    for (const socket of sockets) for (const room of socket.rooms) {
      if (room.startsWith('voice_room_channel:')) rooms.add(room);
    }
    const { getVoiceRoomState, saveVoiceRoomState } = await import('../sockets/voiceRoomSocket');
    for (const room of rooms) {
      if (!room.startsWith('voice_room_channel:')) continue;
      const state = await getVoiceRoomState(room.slice('voice_room_channel:'.length));
      const patch = (user: any) => {
        if (user && [user.userId, user.id, user._id].some(id => keys.has(String(id)))) user.nameEffect = identity.nameEffect;
      };
      Object.values(state.onlineUsers || {}).forEach(patch);
      state.seats.forEach(seat => patch(seat.user));
      patch(state.hostUser);
      await saveVoiceRoomState(state);
    }
    io.to([...rooms]).emit('identity:name-effect-updated', payload);
  } catch (error: any) {
    console.warn('[NameEffect] Live update deferred:', error.message);
  }
}
