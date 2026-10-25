export const entryIsActive = (asset: any, now = Date.now()): boolean => {
  if (!asset || typeof asset !== 'object' || asset.isActive === false) return false;
  if (asset.expiresAt && !(new Date(asset.expiresAt).getTime() > now)) return false;
  return Boolean(asset.animationUrl);
};

export const roomEntryAsset = (asset: any) => {
  if (!entryIsActive(asset)) return null;
  const { image, imageUrl, coverImageUrl, ...playable } = asset;
  return {
    ...playable,
    metadata: {
      ...(asset.metadata || {}),
      showAvatar: asset.metadata?.showAvatar === true || asset.showAvatar === true,
      comingText: String(asset.metadata?.comingText || asset.comingText || 'is coming').slice(0, 80),
    },
  };
};
