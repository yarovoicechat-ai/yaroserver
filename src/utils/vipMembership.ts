import { getVipAssets } from './vipAssets';

export const vipLabel = (value: string = '') => String(value || '').replace(/SVIP/gi, 'VIP');

export function validateVipMedia(data: any): string | null {
  const isImage = (val: string) => /\.(png|jpe?g|webp|gif)(?:[?#]|$)/i.test(val);
  const isSvga = (val: string) => /\.svga(?:[?#]|$)/i.test(val);
  const isValidUrl = (val: string) => typeof val === 'string' && val.length <= 2048 && /^(https?:\/\/|\/api\/|\/uploads\/)/i.test(val);

  const checkMedia = (val: any, name: string, type: 'image' | 'svga') => {
    if (val === undefined || val === null || val === '') return null;
    if (!isValidUrl(val)) return `${name} must be a valid URL starting with http://, https://, or /uploads/`;
    if (type === 'svga' && !isSvga(val)) return `${name} must be a valid .svga animation URL`;
    if (type === 'image' && !isImage(val)) return `${name} must be a valid image (.png, .jpg, .webp, .gif) URL`;
    return null;
  };

  const fieldsToCheck: [string, 'image' | 'svga'][] = [
    ['entryAnimationUrl', 'svga'],
    ['avatarFrameUrl', 'svga'],
    ['entryPreviewUrl', 'image'],
    ['avatarFramePreviewUrl', 'image'],
  ];

  for (const [field, type] of fieldsToCheck) {
    const err = checkMedia(data[field], field, type);
    if (err) return err;
  }

  // Nested configurations check
  const nestedChecks = [
    { config: data.svipTagConfig, img: 'previewUrl', svga: 'animationUrl', label: 'Tag' },
    { config: data.profileBadgeConfig, img: 'previewUrl', svga: 'animationUrl', label: 'Badge' },
    { config: data.svipBubbleConfig, img: 'previewUrl', svga: 'animationUrl', label: 'Bubble' },
    { config: data.profileCardConfig, img: 'previewUrl', svga: 'animationUrl', label: 'Profile Card' },
    { config: data.micWaveConfig, img: 'previewUrl', svga: 'animationUrl', label: 'Mic Wave' },
    { config: data.giftBroadcastConfig, img: 'previewUrl', svga: 'animationUrl', label: 'Gift Broadcast' },
    { config: data.vipIdConfig, img: 'previewUrl', svga: 'animationUrl', label: 'VIP ID' },
  ];

  for (const item of nestedChecks) {
    if (item.config) {
      if (item.img && item.config[item.img]) {
        const err = checkMedia(item.config[item.img], `${item.label} Image`, 'image');
        if (err) return err;
      }
      if (item.svga && item.config[item.svga]) {
        const err = checkMedia(item.config[item.svga], `${item.label} SVGA`, 'svga');
        if (err) return err;
      }
    }
  }

  return null;
}

// Keep existing plan IDs, slugs and entitlements; the former SVIP tiers are VIP.
export function presentVipPlan(plan: any) {
  const defaults = getVipAssets(Number(plan.level));
  const animated = (url: string) => /\.svga(?:[?#]|$)/i.test(url || '');
  const entryAnimationUrl = animated(plan.entryAnimationUrl) ? plan.entryAnimationUrl : defaults?.entry.animationUrl || '';
  const avatarFrameUrl = animated(plan.avatarFrameUrl) ? plan.avatarFrameUrl : defaults?.frame.animationUrl || '';
  return {
    ...plan,
    name: vipLabel(plan.name),
    badge: vipLabel(plan.badge),
    description: vipLabel(plan.description),
    privileges: (plan.privileges || []).map((privilege: any) => ({
      ...privilege, title: vipLabel(privilege.title), description: vipLabel(privilege.description),
    })),
    entryAnimationUrl,
    entryPreviewUrl: plan.entryPreviewUrl || defaults?.entry.imageUrl || '',
    avatarFrameUrl,
    avatarFramePreviewUrl: plan.avatarFramePreviewUrl || defaults?.frame.imageUrl || '',
  };
}

export function membershipAssets(plan: any) {
  const configured = presentVipPlan(plan);
  return {
    frame: plan.features?.enableAvatarFrame !== false && configured.avatarFrameUrl ? {
      id: `vip_frame_${plan.level}`, name: `VIP ${plan.level} Frame`,
      isActive: true,
      animationUrl: configured.avatarFrameUrl, imageUrl: configured.avatarFramePreviewUrl,
    } : null,
    entry: plan.features?.enableEntryEffect !== false && configured.entryAnimationUrl ? {
      id: `vip_entry_${plan.level}`, name: `VIP ${plan.level} Entry`,
      animationUrl: configured.entryAnimationUrl, imageUrl: configured.entryPreviewUrl,
      duration: 5500, isActive: true, animationType: 'FULL_SCREEN',
      metadata: { showAvatar: false, comingText: 'is coming' },
    } : null,
  };
}
