export function roomUserCosmetics(source: any, identity: any, vipExperience: any = {}) {
  const frame = source.equippedFrameAsset || identity?.avatarFrame || source.equippedFrame || null;
  const entry = source.equippedEntryAsset || vipExperience.entryAsset || null;
  return {
    equippedFrame: frame,
    equippedFrameAsset: frame,
    equippedEntry: entry || source.equippedEntry || null,
    equippedEntryAsset: entry,
  };
}
