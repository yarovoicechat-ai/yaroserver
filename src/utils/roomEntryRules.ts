export const isAnimatedUrl = (url: string = ''): boolean => {
  return typeof url === 'string' && /\.(svga|gif|webp|mp4|m4v|mov)(?:[?#]|$)/i.test(url.trim());
};

export const resolveAnimationUrl = (asset: any): string => {
  if (!asset || typeof asset !== 'object') return '';
  const candidate =
    asset.animationUrl ||
    asset.animationURL ||
    asset.svgaUrl ||
    asset.mediaUrl ||
    (isAnimatedUrl(asset.imageUrl) ? asset.imageUrl : '') ||
    (isAnimatedUrl(asset.image) ? asset.image : '') ||
    (isAnimatedUrl(asset.url) ? asset.url : '');
  return typeof candidate === 'string' ? candidate.trim() : '';
};

export const entryIsActive = (asset: any, now = Date.now()): boolean => {
  if (!asset || typeof asset !== 'object' || asset.isActive === false) return false;
  if (asset.expiresAt && !(new Date(asset.expiresAt).getTime() > now)) return false;
  const anim = resolveAnimationUrl(asset);
  const img = asset.imageUrl || asset.image || asset.url || '';
  return Boolean(anim || img || asset.name);
};

export const roomEntryAsset = (asset: any) => {
  if (!entryIsActive(asset)) return null;
  const anim = resolveAnimationUrl(asset);
  const img = asset.imageUrl || asset.image || asset.url || asset.coverImageUrl || '';
  return {
    ...asset,
    id: asset.id || asset._id || asset.itemId || asset.name || '',
    name: asset.name || 'Entrance Effect',
    animationUrl: anim || asset.animationUrl || '',
    imageUrl: img,
    image: img,
    bannerColors: Array.isArray(asset.bannerColors) && asset.bannerColors.length >= 2
      ? asset.bannerColors
      : Array.isArray(asset.bgColors) && asset.bgColors.length >= 2
      ? asset.bgColors
      : ['#06B6D4', '#0E7490'],
    metadata: {
      ...(asset.metadata || {}),
      showAvatar: asset.metadata?.showAvatar === true || asset.showAvatar === true,
      comingText: String(asset.metadata?.comingText || asset.comingText || 'is coming').slice(0, 80),
    },
  };
};
