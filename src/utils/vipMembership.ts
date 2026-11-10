import { getVipAssets } from './vipAssets';

export const vipLabel = (value: string = '') => String(value || '').replace(/SVIP/gi, 'VIP');

export function validateVipMedia(data: any): string | null {
  for (const [field, extension] of [
    ['entryAnimationUrl', 'svga'], ['avatarFrameUrl', 'svga'],
    ['entryPreviewUrl', 'png'], ['avatarFramePreviewUrl', 'png'],
  ]) {
    const value = data[field];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || value.length > 2048 ||
        !/^(https?:\/\/|\/api\/|\/uploads\/)/i.test(value) ||
        !new RegExp(`\\.${extension}(?:[?#]|$)`, 'i').test(value)) {
      return `${field} must be a valid .${extension} asset URL`;
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
