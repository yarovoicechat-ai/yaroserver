// Served by the backend; never bundle these files in the mobile application.
export function getVipAssets(level: number) {
  if (!Number.isInteger(level) || level < 1 || level > 5) return null;
  const root = '/api/vip-assets';
  return {
    frame: {
      id: `vip_frame_${level}`,
      name: `VIP ${level} Frame`,
      isActive: true,
      imageUrl: `${root}/frame/vip_frame_${level}.png`,
      animationUrl: `${root}/frame/vip_frame_${level}.svga`,
    },
    entry: {
      id: `vip_entry_${level}`,
      name: `VIP ${level} Entry`,
      imageUrl: `${root}/entry/vip_entry_${level}.png`,
      animationUrl: `${root}/entry/vip_entry_${level}.svga`,
      animationType: 'FULL_SCREEN',
      duration: 5500,
      isActive: true,
      metadata: { showAvatar: false, comingText: 'is coming' },
    },
    badge: {
      id: `vip_badge_${level}`,
      name: `VIP ${level} Badge`,
      imageUrl: `${root}/badge/vip_badge_${level}.png`,
      animationUrl: `${root}/badge/vip_badge_${level}.svga`,
      isActive: true,
    },
  };
}
