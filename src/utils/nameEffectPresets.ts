const definitions = [
  ['Rainbow Flow', 'rainbow-flow', 'rainbow', 1, ['#FF667D', '#FFAC4D', '#FFE66D', '#74E89A', '#5CDFF3', '#9AA7FF', '#EA8CFF']],
  ['Royal Gold', 'royal-gold', 'shimmer', 0.8, ['#E6B94F', '#FFF6CE', '#FFD45E', '#C98B28']],
  ['Cyber Neon', 'cyber-neon', 'neon', 1.3, ['#2DF4FF', '#6887FF', '#E873FF', '#79FFF2']],
  ['Ruby Flame', 'ruby-flame', 'gradient_scroll', 1.2, ['#FF4E65', '#FF9561', '#FFE2A3', '#ED557D']],
  ['Ocean Wave', 'ocean-wave', 'gradient_scroll', 0.7, ['#58BFFF', '#76EBFF', '#DBFCFF', '#798CFF']],
  ['Emerald Pulse', 'emerald-pulse', 'glow_pulse', 0.75, ['#45D79A', '#B8FFD9', '#E2FFE8', '#60D6BA']],
  ['Royal Aurora', 'royal-aurora', 'rainbow', 0.85, ['#B28AFF', '#F2B0FF', '#8EDBFF', '#D7C4FF']],
  ['Rose Pearl', 'rose-pearl', 'shimmer', 0.65, ['#ED86B9', '#FFF0F8', '#FFC3D8', '#DDA5FF']],
  ['Ice Crystal', 'ice-crystal', 'shimmer', 1, ['#7AD8F5', '#F2FFFF', '#C2EEFF', '#A7B8FF']],
  ['Sunset Candy', 'sunset-candy', 'rainbow', 1.15, ['#FF93C2', '#FFBA8C', '#FFF0A6', '#DFA2FF']],
] as const;

export const NAME_EFFECT_PRESETS = definitions.map(([name, slug, animationType, animationSpeed, colors], index) => ({
  name, slug: 'name-effect-' + slug, category: 'animated_name' as const,
  description: name + ' animated lettering. Applied by the panel to any account.',
  config: { colors: [...colors], animationType, animationSpeed, gradientDirection: 'horizontal', prefixBadge: '' },
  previewBg: 'dark', eligibleTiers: ['all'], priceDiamonds: 0, isPurchasable: false,
  status: 'active', validityDays: 30, sortOrder: index + 1,
  metadata: { panelOnly: true, presetVersion: 1 },
}));

export function nameEffectExpiry(days: unknown, startsAt = new Date()): Date {
  const value = Number(days);
  if (!Number.isInteger(value) || value < 0 || value > 3650) throw new Error('Validity must be 0 (permanent) or 1-3650 days');
  return value === 0 ? new Date('9999-12-31T23:59:59.999Z')
    : new Date(startsAt.getTime() + value * 86400000);
}
