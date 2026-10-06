// levelEngine.ts - Canonical Level Progression & Reward Engine for Yaro
// Pure, deterministic source of truth for Wealth & Charm levels

export interface LevelRewardItem {
  id: string;
  name: string;
  type: 'badge' | 'frame' | 'vehicle' | 'custom_id' | 'entrance' | 'profile_border' | 'theme' | 'mic' | 'room_skin' | 'party_set';
  categoryName: string;
  requiredLevel: number;
  durationDays: number; // 0 = permanent
  imageUrl?: string;
  animationUrl?: string;
  previewColor?: string;
  description?: string;
  exclusive?: boolean;
}

export interface LevelThreshold {
  level: number;
  requiredExp: number; // Cumulative EXP to reach this level
  title: string;
  tier: string;
  badgeIcon: string;
  color: string;
}

// ==========================================
// 1. WEALTH LEVEL THRESHOLDS (Lv 1 to Lv 150)
// ==========================================
// Level 4 threshold: 6,000. Next level (Lv 5) threshold: 15,000.
// So at 8,350 EXP: Wealth Lv.4, 8,350 / 15,000, 6,650 remaining!
export const generateWealthThresholds = (maxLevel: number = 150): LevelThreshold[] => {
  const list: LevelThreshold[] = [];
  for (let lvl = 1; lvl <= maxLevel; lvl++) {
    let requiredExp = 0;
    if (lvl === 1) {
      requiredExp = 0;
    } else if (lvl === 2) {
      requiredExp = 1000;
    } else if (lvl === 3) {
      requiredExp = 3000;
    } else if (lvl === 4) {
      requiredExp = 6000;
    } else if (lvl === 5) {
      requiredExp = 15000;
    } else if (lvl <= 10) {
      requiredExp = 15000 + (lvl - 5) * 20000; // Lv10 = 115,000
    } else if (lvl <= 20) {
      requiredExp = 115000 + (lvl - 10) * 50000; // Lv20 = 615,000
    } else if (lvl <= 30) {
      requiredExp = 615000 + (lvl - 20) * 120000; // Lv30 = 1,815,000
    } else if (lvl <= 40) {
      requiredExp = 1815000 + (lvl - 30) * 250000; // Lv40 = 4,315,000
    } else if (lvl <= 50) {
      requiredExp = 4315000 + (lvl - 40) * 450000; // Lv50 = 8,815,000
    } else if (lvl <= 60) {
      requiredExp = 8815000 + (lvl - 50) * 750000; // Lv60 = 16,315,000
    } else if (lvl <= 70) {
      requiredExp = 16315000 + (lvl - 60) * 1200000; // Lv70 = 28,315,000
    } else if (lvl <= 80) {
      requiredExp = 28315000 + (lvl - 70) * 1800000; // Lv80 = 46,315,000
    } else if (lvl <= 90) {
      requiredExp = 46315000 + (lvl - 80) * 2600000; // Lv90 = 72,315,000
    } else if (lvl <= 100) {
      requiredExp = 72315000 + (lvl - 90) * 3600000; // Lv100 = 108,315,000
    } else {
      requiredExp = 108315000 + (lvl - 100) * 5000000; // Lv150 = 358,315,000
    }

    let tier = 'Bronze Monarch';
    let badgeIcon = '🥉';
    let color = '#CD7F32';
    if (lvl >= 140) {
      tier = 'Omnipotent Apex';
      badgeIcon = '👑';
      color = '#FFD700';
    } else if (lvl >= 120) {
      tier = 'Mythic Sovereign';
      badgeIcon = '🔱';
      color = '#F59E0B';
    } else if (lvl >= 100) {
      tier = 'Cosmic Legend';
      badgeIcon = '🌌';
      color = '#A855F7';
    } else if (lvl >= 80) {
      tier = 'Obsidian Overlord';
      badgeIcon = '💎';
      color = '#38BDF8';
    } else if (lvl >= 60) {
      tier = 'Diamond Emperor';
      badgeIcon = '💎';
      color = '#06B6D4';
    } else if (lvl >= 40) {
      tier = 'Amber Sovereign';
      badgeIcon = '🌟';
      color = '#EAB308';
    } else if (lvl >= 20) {
      tier = 'Silver Vanguard';
      badgeIcon = '🥈';
      color = '#94A3B8';
    } else if (lvl >= 10) {
      tier = 'Golden Regent';
      badgeIcon = '🥇';
      color = '#F59E0B';
    }

    list.push({
      level: lvl,
      requiredExp,
      title: `Wealth Lv.${lvl}`,
      tier,
      badgeIcon,
      color,
    });
  }
  return list;
};

// ==========================================
// 2. CHARM LEVEL THRESHOLDS (Lv 1 to Lv 150)
// ==========================================
export const generateCharmThresholds = (maxLevel: number = 150): LevelThreshold[] => {
  const list: LevelThreshold[] = [];
  for (let lvl = 1; lvl <= maxLevel; lvl++) {
    let requiredExp = 0;
    if (lvl === 1) {
      requiredExp = 0;
    } else if (lvl === 2) {
      requiredExp = 500;
    } else if (lvl === 3) {
      requiredExp = 2000;
    } else if (lvl === 4) {
      requiredExp = 5000;
    } else if (lvl === 5) {
      requiredExp = 10000;
    } else if (lvl <= 10) {
      requiredExp = 10000 + (lvl - 5) * 15000; // Lv10 = 85,000
    } else if (lvl <= 20) {
      requiredExp = 85000 + (lvl - 10) * 40000; // Lv20 = 485,000
    } else if (lvl <= 30) {
      requiredExp = 485000 + (lvl - 20) * 90000; // Lv30 = 1,385,000
    } else if (lvl <= 40) {
      requiredExp = 1385000 + (lvl - 30) * 180000; // Lv40 = 3,185,000
    } else if (lvl <= 50) {
      requiredExp = 3185000 + (lvl - 40) * 320000; // Lv50 = 6,385,000
    } else if (lvl <= 60) {
      requiredExp = 6385000 + (lvl - 50) * 500000; // Lv60 = 11,385,000
    } else if (lvl <= 70) {
      requiredExp = 11385000 + (lvl - 60) * 800000; // Lv70 = 19,385,000
    } else if (lvl <= 80) {
      requiredExp = 19385000 + (lvl - 70) * 1200000; // Lv80 = 31,385,000
    } else if (lvl <= 90) {
      requiredExp = 31385000 + (lvl - 80) * 1700000; // Lv90 = 48,385,000
    } else if (lvl <= 100) {
      requiredExp = 48385000 + (lvl - 90) * 2400000; // Lv100 = 72,385,000
    } else {
      requiredExp = 72385000 + (lvl - 100) * 3500000; // Lv150 = 247,385,000
    }

    let tier = 'Sweet Blossom';
    let badgeIcon = '🌸';
    let color = '#EC4899';
    if (lvl >= 140) {
      tier = 'Eternal Goddess';
      badgeIcon = '👑';
      color = '#F43F5E';
    } else if (lvl >= 120) {
      tier = 'Celestial Diva';
      badgeIcon = '✨';
      color = '#D946EF';
    } else if (lvl >= 100) {
      tier = 'Superstar Idol';
      badgeIcon = '💖';
      color = '#EC4899';
    } else if (lvl >= 80) {
      tier = 'Enchanting Siren';
      badgeIcon = '🌺';
      color = '#A855F7';
    } else if (lvl >= 60) {
      tier = 'Radiant Queen';
      badgeIcon = '💫';
      color = '#8B5CF6';
    } else if (lvl >= 40) {
      tier = 'Glamour Star';
      badgeIcon = '⭐';
      color = '#F472B6';
    } else if (lvl >= 20) {
      tier = 'Graceful Muse';
      badgeIcon = '🌷';
      color = '#FB7185';
    } else if (lvl >= 10) {
      tier = 'Rising Idol';
      badgeIcon = '🎀';
      color = '#F43F5E';
    }

    list.push({
      level: lvl,
      requiredExp,
      title: `Charm Lv.${lvl}`,
      tier,
      badgeIcon,
      color,
    });
  }
  return list;
};

export const WEALTH_THRESHOLDS = generateWealthThresholds(150);
export const CHARM_THRESHOLDS = generateCharmThresholds(150);

// ==========================================
// 3. WEALTH REWARD CATALOG
// ==========================================
export const WEALTH_REWARDS: LevelRewardItem[] = [
  // BADGES (Milestones Lv.10 to Lv.140+)
  { id: 'w_badge_10', name: 'Wealth Lv.10 Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 10, durationDays: 0, description: 'Exclusive Lv.10 Wealth Badge', previewColor: '#CD7F32' },
  { id: 'w_badge_20', name: 'Wealth Lv.20 Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 20, durationDays: 0, description: 'Exclusive Lv.20 Silver Vanguard Badge', previewColor: '#94A3B8' },
  { id: 'w_badge_30', name: 'Wealth Lv.30 Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 30, durationDays: 0, description: 'Exclusive Lv.30 Golden Regent Badge', previewColor: '#F59E0B' },
  { id: 'w_badge_40', name: 'Wealth Lv.40 Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 40, durationDays: 0, description: 'Exclusive Lv.40 Amber Sovereign Badge', previewColor: '#EAB308' },
  { id: 'w_badge_50', name: 'Wealth Lv.50 Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 50, durationDays: 0, description: 'Exclusive Lv.50 Platinum Knight Badge', previewColor: '#38BDF8' },
  { id: 'w_badge_60', name: 'Wealth Lv.60 Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 60, durationDays: 0, description: 'Enlarged Milestone Wealth Lv.60 Badge', previewColor: '#06B6D4', exclusive: true },
  { id: 'w_badge_70', name: 'Wealth Lv.70 Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 70, durationDays: 0, description: 'Exclusive Lv.70 Diamond Emperor Badge', previewColor: '#0EA5E9' },
  { id: 'w_badge_80', name: 'Wealth Lv.80 Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 80, durationDays: 0, description: 'Exclusive Lv.80 Obsidian Overlord Badge', previewColor: '#6366F1' },
  { id: 'w_badge_90', name: 'Wealth Lv.90 Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 90, durationDays: 0, description: 'Exclusive Lv.90 Celestial Ruler Badge', previewColor: '#8B5CF6' },
  { id: 'w_badge_100', name: 'Wealth Lv.100 Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 100, durationDays: 0, description: 'Legendary Lv.100 Cosmic Legend Badge', previewColor: '#A855F7', exclusive: true },
  { id: 'w_badge_110', name: 'Wealth Lv.110 Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 110, durationDays: 0, description: 'Exclusive Lv.110 Eternal Titan Badge', previewColor: '#D946EF' },
  { id: 'w_badge_120', name: 'Wealth Lv.120 Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 120, durationDays: 0, description: 'Mythic Lv.120 Sovereign Badge', previewColor: '#EC4899', exclusive: true },
  { id: 'w_badge_130', name: 'Wealth Lv.130 Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 130, durationDays: 0, description: 'Exclusive Lv.130 Galaxy Supreme Badge', previewColor: '#F43F5E' },
  { id: 'w_badge_140', name: 'Wealth Lv.140 Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 140, durationDays: 0, description: 'Apex Lv.140 Infinity Monarch Badge', previewColor: '#FFD700', exclusive: true },

  // FRAMES
  { id: 'w_frame_5', name: 'Wealth Lv.5 Bronze Glory Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 5, durationDays: 7, description: 'Bronze halo avatar frame for 7 days', previewColor: '#CD7F32' },
  { id: 'w_frame_15', name: 'Wealth Lv.15 Silver Crest Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 15, durationDays: 15, description: 'Silver wing avatar frame for 15 days', previewColor: '#94A3B8' },
  { id: 'w_frame_25', name: 'Wealth Lv.25 Golden Phoenix Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 25, durationDays: 30, description: 'Imperial gold avatar frame for 30 days', previewColor: '#F59E0B' },
  { id: 'w_frame_45', name: 'Wealth Lv.45 Amber Dragon Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 45, durationDays: 30, description: 'Amber dragon avatar frame for 30 days', previewColor: '#EAB308' },
  { id: 'w_frame_65', name: 'Wealth Lv.65 Diamond Nebula Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 65, durationDays: 60, description: 'Brilliant diamond avatar frame for 60 days', previewColor: '#06B6D4' },
  { id: 'w_frame_85', name: 'Wealth Lv.85 Celestial Corona Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 85, durationDays: 90, description: 'Celestial aura avatar frame for 90 days', previewColor: '#8B5CF6' },
  { id: 'w_frame_100', name: 'Wealth Lv.100 Mythic Eternity Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 100, durationDays: 0, description: 'Permanent Mythic avatar frame', previewColor: '#EC4899', exclusive: true },
  { id: 'w_frame_120', name: 'Wealth Lv.120 Cosmic Sovereign Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 120, durationDays: 0, description: 'Permanent Cosmic Sovereign avatar frame', previewColor: '#F59E0B', exclusive: true },
  { id: 'w_frame_140', name: 'Wealth Lv.140 Omnipotent Halo Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 140, durationDays: 0, description: 'Permanent Omnipotent Halo frame', previewColor: '#FFD700', exclusive: true },

  // VEHICLES
  { id: 'w_veh_20', name: 'Neon Cyber Bike', type: 'vehicle', categoryName: 'Vehicle', requiredLevel: 20, durationDays: 7, description: 'High speed neon motorcycle for 7 days', previewColor: '#06B6D4' },
  { id: 'w_veh_40', name: 'Royal Phantom Roadster', type: 'vehicle', categoryName: 'Vehicle', requiredLevel: 40, durationDays: 15, description: 'Luxury roadster entrance vehicle for 15 days', previewColor: '#F59E0B' },
  { id: 'w_veh_60', name: 'Golden Hypercar', type: 'vehicle', categoryName: 'Vehicle', requiredLevel: 60, durationDays: 30, description: 'Gold hypercar entrance vehicle for 30 days', previewColor: '#EAB308', exclusive: true },
  { id: 'w_veh_80', name: 'Diamond Jetliner', type: 'vehicle', categoryName: 'Vehicle', requiredLevel: 80, durationDays: 60, description: 'Private supersonic jetliner for 60 days', previewColor: '#38BDF8' },
  { id: 'w_veh_100', name: 'Pegasus Celestial Warp', type: 'vehicle', categoryName: 'Vehicle', requiredLevel: 100, durationDays: 0, description: 'Permanent mythical pegasus celestial mount', previewColor: '#A855F7', exclusive: true },
  { id: 'w_veh_120', name: 'Void Star Battleship', type: 'vehicle', categoryName: 'Vehicle', requiredLevel: 120, durationDays: 0, description: 'Permanent cosmic mothership room arrival', previewColor: '#6366F1', exclusive: true },
  { id: 'w_veh_140', name: 'Phoenix Divine Chariot', type: 'vehicle', categoryName: 'Vehicle', requiredLevel: 140, durationDays: 0, description: 'Permanent fiery divine sun chariot', previewColor: '#FFD700', exclusive: true },

  // CUSTOM ID STYLES
  { id: 'w_cid_30', name: '7-Digit Golden ID Style', type: 'custom_id', categoryName: 'Custom ID', requiredLevel: 30, durationDays: 30, description: 'Shining gold profile ID badge style for 30 days', previewColor: '#F59E0B' },
  { id: 'w_cid_50', name: '6-Digit Lucky Diamond ID', type: 'custom_id', categoryName: 'Custom ID', requiredLevel: 50, durationDays: 60, description: 'Diamond glow profile ID badge style for 60 days', previewColor: '#06B6D4' },
  { id: 'w_cid_75', name: '5-Digit Royal Sovereign ID', type: 'custom_id', categoryName: 'Custom ID', requiredLevel: 75, durationDays: 90, description: 'Sovereign crown profile ID style for 90 days', previewColor: '#8B5CF6' },
  { id: 'w_cid_100', name: '4-Digit Celestial Crown ID', type: 'custom_id', categoryName: 'Custom ID', requiredLevel: 100, durationDays: 0, description: 'Permanent 4-Digit Celestial Crown ID styling', previewColor: '#EC4899', exclusive: true },
  { id: 'w_cid_130', name: '3-Digit Mythic Supreme ID', type: 'custom_id', categoryName: 'Custom ID', requiredLevel: 130, durationDays: 0, description: 'Permanent 3-Digit Mythic Supreme ID styling', previewColor: '#FFD700', exclusive: true },

  // ENTRANCE EFFECTS
  { id: 'w_ent_10', name: 'Starlight Flash Entrance', type: 'entrance', categoryName: 'Entrance', requiredLevel: 10, durationDays: 7, description: 'Starlight flash room arrival effect for 7 days', previewColor: '#CD7F32' },
  { id: 'w_ent_30', name: 'Royal Golden Burst Entrance', type: 'entrance', categoryName: 'Entrance', requiredLevel: 30, durationDays: 15, description: 'Golden fireworks arrival effect for 15 days', previewColor: '#F59E0B' },
  { id: 'w_ent_50', name: 'Phoenix Flare Entrance', type: 'entrance', categoryName: 'Entrance', requiredLevel: 50, durationDays: 30, description: 'Fiery phoenix room arrival for 30 days', previewColor: '#EF4444' },
  { id: 'w_ent_70', name: 'Galaxy Warp Portal Entrance', type: 'entrance', categoryName: 'Entrance', requiredLevel: 70, durationDays: 60, description: 'Cosmic warp portal arrival for 60 days', previewColor: '#8B5CF6' },
  { id: 'w_ent_90', name: 'Dragon Descent Entrance', type: 'entrance', categoryName: 'Entrance', requiredLevel: 90, durationDays: 90, description: 'Golden dragon descent arrival for 90 days', previewColor: '#EAB308' },
  { id: 'w_ent_110', name: 'God of Wealth Advent Entrance', type: 'entrance', categoryName: 'Entrance', requiredLevel: 110, durationDays: 0, description: 'Permanent God of Wealth advent arrival animation', previewColor: '#FFD700', exclusive: true },
  { id: 'w_ent_130', name: 'Celestial Genesis Entrance', type: 'entrance', categoryName: 'Entrance', requiredLevel: 130, durationDays: 0, description: 'Permanent universe genesis room entrance', previewColor: '#A855F7', exclusive: true },

  // PROFILE PAGE BORDER
  { id: 'w_pbr_15', name: 'Silver Laurel Profile Border', type: 'profile_border', categoryName: 'Profile Page Border', requiredLevel: 15, durationDays: 15, description: 'Silver laurel ornamental profile page border for 15 days', previewColor: '#94A3B8' },
  { id: 'w_pbr_35', name: 'Golden Royal Crest Border', type: 'profile_border', categoryName: 'Profile Page Border', requiredLevel: 35, durationDays: 30, description: 'Gold filigree profile page border for 30 days', previewColor: '#F59E0B' },
  { id: 'w_pbr_55', name: 'Diamond Crystal Glow Border', type: 'profile_border', categoryName: 'Profile Page Border', requiredLevel: 55, durationDays: 60, description: 'Diamond crystal radiant profile border for 60 days', previewColor: '#06B6D4' },
  { id: 'w_pbr_75', name: 'Celestial Aurora Border', type: 'profile_border', categoryName: 'Profile Page Border', requiredLevel: 75, durationDays: 90, description: 'Aurora borealis animated profile border for 90 days', previewColor: '#8B5CF6' },
  { id: 'w_pbr_95', name: 'Mythic Dragon Guard Border', type: 'profile_border', categoryName: 'Profile Page Border', requiredLevel: 95, durationDays: 0, description: 'Permanent Mythic twin dragon profile page border', previewColor: '#EC4899', exclusive: true },
  { id: 'w_pbr_125', name: 'Imperial Crown Border', type: 'profile_border', categoryName: 'Profile Page Border', requiredLevel: 125, durationDays: 0, description: 'Permanent Imperial Crown gold diamond profile border', previewColor: '#FFD700', exclusive: true },

  // CUSTOM THEMES
  { id: 'w_thm_25', name: 'Royal Gold Velvet Theme', type: 'theme', categoryName: 'Custom Theme', requiredLevel: 25, durationDays: 30, description: 'Rich royal gold velvet room atmosphere for 30 days', previewColor: '#F59E0B' },
  { id: 'w_thm_50', name: 'Cyberpunk Neon Theme', type: 'theme', categoryName: 'Custom Theme', requiredLevel: 50, durationDays: 60, description: 'Futuristic high-tech neon room theme for 60 days', previewColor: '#06B6D4' },
  { id: 'w_thm_75', name: 'Deep Cosmos Theme', type: 'theme', categoryName: 'Custom Theme', requiredLevel: 75, durationDays: 90, description: 'Infinite deep cosmos starry theme for 90 days', previewColor: '#8B5CF6' },
  { id: 'w_thm_100', name: 'Mythic Obsidian Flame Theme', type: 'theme', categoryName: 'Custom Theme', requiredLevel: 100, durationDays: 0, description: 'Permanent Mythic obsidian flame room theme', previewColor: '#EC4899', exclusive: true },
  { id: 'w_thm_120', name: 'Celestial Galaxy Theme', type: 'theme', categoryName: 'Custom Theme', requiredLevel: 120, durationDays: 0, description: 'Permanent Celestial galaxy interactive room skin', previewColor: '#FFD700', exclusive: true },
];

// ==========================================
// 4. CHARM REWARD PACKAGES (By Milestone)
// ==========================================
export interface CharmMilestonePackage {
  level: number;
  title: string;
  badge: string;
  color: string;
  rewards: LevelRewardItem[];
}

export const CHARM_MILESTONES: number[] = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];

export const CHARM_PACKAGES: Record<number, LevelRewardItem[]> = {
  1: [
    { id: 'c_bdg_1', name: 'Charm Lv.1 Novice Idol Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 1, durationDays: 0, previewColor: '#EC4899', description: 'Novice host charm badge' },
    { id: 'c_frm_1', name: 'Blossom Starter Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 1, durationDays: 7, previewColor: '#F472B6', description: 'Pink flower starter frame' },
  ],
  10: [
    { id: 'c_bdg_10', name: 'Charm Lv.10 Rising Idol Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 10, durationDays: 0, previewColor: '#F43F5E', description: 'Rising idol host badge' },
    { id: 'c_frm_10', name: 'Charm Blossom Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 10, durationDays: 15, previewColor: '#FB7185', description: 'Sakura petals avatar frame' },
    { id: 'c_ent_10', name: 'Sakura Petals Entrance', type: 'entrance', categoryName: 'Entrance', requiredLevel: 10, durationDays: 15, previewColor: '#FDA4AF', description: 'Gentle sakura shower entrance effect' },
    { id: 'c_mic_10', name: 'Celebration Mic', type: 'mic', categoryName: 'Celebration Mic', requiredLevel: 10, durationDays: 15, previewColor: '#F472B6', description: 'Glittering pink celebration host microphone' },
  ],
  20: [
    { id: 'c_bdg_20', name: 'Charm Lv.20 Graceful Muse Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 20, durationDays: 0, previewColor: '#EC4899', description: 'Graceful muse host badge' },
    { id: 'c_frm_20', name: 'Graceful Angel Wings Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 20, durationDays: 30, previewColor: '#D946EF', description: 'Feathered pink angel wings avatar frame' },
    { id: 'c_ent_20', name: 'Fairy Sparkles Entrance', type: 'entrance', categoryName: 'Entrance', requiredLevel: 20, durationDays: 30, previewColor: '#E879F9', description: 'Enchanted fairy sparkle room arrival' },
    { id: 'c_thm_20', name: 'Blossom Garden Static Theme', type: 'theme', categoryName: 'Exclusive Static Theme', requiredLevel: 20, durationDays: 30, previewColor: '#F472B6', description: 'Serene cherry blossom garden room theme' },
    { id: 'c_mic_20', name: 'Music Mic Theme', type: 'mic', categoryName: 'Music Mic Theme', requiredLevel: 20, durationDays: 30, previewColor: '#A855F7', description: 'Melodic musical note glowing mic skin' },
  ],
  30: [
    { id: 'c_bdg_30', name: 'Charm Lv.30 Sparkling Star Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 30, durationDays: 0, previewColor: '#D946EF', description: 'Sparkling star charm badge' },
    { id: 'c_frm_30', name: 'Pink Crystal Tiara Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 30, durationDays: 30, previewColor: '#C084FC', description: 'Crystal tiara frame' },
    { id: 'c_pty_30', name: 'Birthday Party Set', type: 'party_set', categoryName: 'Birthday Party Set', requiredLevel: 30, durationDays: 30, previewColor: '#F43F5E', description: 'Exclusive birthday banners & balloons party set' },
    { id: 'c_mic_30', name: 'DJ Mic Theme', type: 'mic', categoryName: 'DJ Mic Theme', requiredLevel: 30, durationDays: 30, previewColor: '#8B5CF6', description: 'Cyber DJ neon equalizer mic wave skin' },
  ],
  40: [
    { id: 'c_bdg_40', name: 'Charm Lv.40 Glamour Star Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 40, durationDays: 0, previewColor: '#A855F7', description: 'Glamour star badge' },
    { id: 'c_frm_40', name: 'Golden Ribbon Charm Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 40, durationDays: 60, previewColor: '#F59E0B', description: 'Gold & rose satin ribbon frame' },
    { id: 'c_rsk_40', name: '12-Mic Room/New Layout Skin', type: 'room_skin', categoryName: '12-Mic Room/New', requiredLevel: 40, durationDays: 60, previewColor: '#7C3AED', description: 'Exclusive expanded 12-Mic amphitheater room layout' },
  ],
  50: [
    { id: 'c_bdg_50', name: 'Charm Lv.50 Velvet Princess Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 50, durationDays: 0, previewColor: '#8B5CF6', description: 'Velvet princess charm badge' },
    { id: 'c_frm_50', name: 'Rose Heart Diamond Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 50, durationDays: 60, previewColor: '#EC4899', description: 'Diamond cut heart frame' },
    { id: 'c_ent_50', name: 'Princess Carriage Entrance', type: 'entrance', categoryName: 'Entrance', requiredLevel: 50, durationDays: 60, previewColor: '#F43F5E', description: 'Glittering enchanted crystal carriage arrival' },
    { id: 'c_thm_50', name: 'Starlight Concert Stage Theme', type: 'theme', categoryName: 'Exclusive Static Theme', requiredLevel: 50, durationDays: 60, previewColor: '#6366F1', description: 'Spotlight stadium concert stage room skin' },
  ],
  60: [
    { id: 'c_bdg_60', name: 'Charm Lv.60 Radiant Queen Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 60, durationDays: 0, previewColor: '#F43F5E', description: 'Special Milestone Charm Lv.60 Radiant Queen Badge', exclusive: true },
    { id: 'c_frm_60', name: 'Imperial Rose Crown Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 60, durationDays: 90, previewColor: '#FB7185', description: 'Majestic red rose imperial crown frame' },
    { id: 'c_mic_60', name: 'Radiant Crystal Mic Theme', type: 'mic', categoryName: 'Music Mic Theme', requiredLevel: 60, durationDays: 90, previewColor: '#EC4899', description: 'Crystal rainbow soundwave microphone' },
  ],
  70: [
    { id: 'c_bdg_70', name: 'Charm Lv.70 Enchanting Diva Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 70, durationDays: 0, previewColor: '#D946EF', description: 'Enchanting diva badge' },
    { id: 'c_frm_70', name: 'Astral Butterfly Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 70, durationDays: 90, previewColor: '#C084FC', description: 'Glowing astral butterflies frame' },
    { id: 'c_ent_70', name: 'Pegasus Wings Arrival', type: 'entrance', categoryName: 'Entrance', requiredLevel: 70, durationDays: 90, previewColor: '#A855F7', description: 'Glowing celestial pegasus room entrance' },
  ],
  80: [
    { id: 'c_bdg_80', name: 'Charm Lv.80 Superstar Idol Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 80, durationDays: 0, previewColor: '#EC4899', description: 'Superstar idol badge' },
    { id: 'c_frm_80', name: 'Golden Goddess Diadem Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 80, durationDays: 0, previewColor: '#F59E0B', description: 'Permanent golden goddess diadem frame', exclusive: true },
    { id: 'c_thm_80', name: 'Palace of Roses Theme', type: 'theme', categoryName: 'Exclusive Static Theme', requiredLevel: 80, durationDays: 0, previewColor: '#F43F5E', description: 'Permanent grand royal rose palace room theme', exclusive: true },
  ],
  90: [
    { id: 'c_bdg_90', name: 'Charm Lv.90 Celestial Empress Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 90, durationDays: 0, previewColor: '#8B5CF6', description: 'Celestial empress badge' },
    { id: 'c_frm_90', name: 'Cosmic Halo Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 90, durationDays: 0, previewColor: '#A855F7', description: 'Permanent cosmic spinning halo avatar frame', exclusive: true },
    { id: 'c_ent_90', name: 'Galaxy Goddess Descent Entrance', type: 'entrance', categoryName: 'Entrance', requiredLevel: 90, durationDays: 0, previewColor: '#6366F1', description: 'Permanent galaxy goddess room descent', exclusive: true },
  ],
  100: [
    { id: 'c_bdg_100', name: 'Charm Lv.100 Eternal Deity Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 100, durationDays: 0, previewColor: '#FFD700', description: 'Permanent Legendary Lv.100 Deity Badge', exclusive: true },
    { id: 'c_frm_100', name: 'Infinity Lotus Diadem Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 100, durationDays: 0, previewColor: '#FFD700', description: 'Permanent infinity golden lotus frame', exclusive: true },
    { id: 'c_pty_100', name: 'All-Star Gala VIP Party Set', type: 'party_set', categoryName: 'Birthday Party Set', requiredLevel: 100, durationDays: 0, previewColor: '#EC4899', description: 'Permanent grand celebrity gala room decoration pack', exclusive: true },
    { id: 'c_rsk_100', name: 'God Level 12-Mic Golden Temple', type: 'room_skin', categoryName: '12-Mic Room/New', requiredLevel: 100, durationDays: 0, previewColor: '#FFD700', description: 'Permanent luxury golden temple 12-mic room layout', exclusive: true },
  ],
  110: [
    { id: 'c_bdg_110', name: 'Charm Lv.110 Celestial Diva Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 110, durationDays: 0, previewColor: '#D946EF', description: 'Celestial diva badge' },
    { id: 'c_frm_110', name: 'Divine Amethyst Corona Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 110, durationDays: 0, previewColor: '#C084FC', description: 'Permanent amethyst corona frame', exclusive: true },
  ],
  120: [
    { id: 'c_bdg_120', name: 'Charm Lv.120 Mythic Muse Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 120, durationDays: 0, previewColor: '#F43F5E', description: 'Mythic muse badge' },
    { id: 'c_frm_120', name: 'Phoenix Feather Aura Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 120, durationDays: 0, previewColor: '#FB7185', description: 'Permanent fiery feather aura frame', exclusive: true },
  ],
  130: [
    { id: 'c_bdg_130', name: 'Charm Lv.130 Universe Siren Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 130, durationDays: 0, previewColor: '#A855F7', description: 'Universe siren badge' },
    { id: 'c_frm_130', name: 'Nebula Starlight Diadem Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 130, durationDays: 0, previewColor: '#8B5CF6', description: 'Permanent nebula starlight frame', exclusive: true },
  ],
  140: [
    { id: 'c_bdg_140', name: 'Charm Lv.140 Infinity Empress Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 140, durationDays: 0, previewColor: '#EC4899', description: 'Infinity empress badge' },
    { id: 'c_frm_140', name: 'Prismatic Diamond Halo Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 140, durationDays: 0, previewColor: '#38BDF8', description: 'Permanent prismatic diamond halo frame', exclusive: true },
  ],
  150: [
    { id: 'c_bdg_150', name: 'Charm Lv.150 Eternal Apex Goddess Badge', type: 'badge', categoryName: 'Badge', requiredLevel: 150, durationDays: 0, previewColor: '#FFD700', description: 'Permanent Apex Goddess Badge', exclusive: true },
    { id: 'c_frm_150', name: 'Omnipotent Golden Aura Frame', type: 'frame', categoryName: 'Frame', requiredLevel: 150, durationDays: 0, previewColor: '#FFD700', description: 'Permanent omnipotent golden aura frame', exclusive: true },
  ],
};

// ==========================================
// 5. ENGINE CALCULATION FUNCTIONS
// ==========================================

export interface LevelProgressResult {
  level: number;
  currentExp: number;
  nextLevelExp: number;
  floorExp: number;
  remainingExp: number;
  progressPercent: number; // 0 to 100
  isMaxLevel: boolean;
  tier: string;
  badgeIcon: string;
  color: string;
}

export const calculateWealthLevel = (exp: number): number => {
  const safeExp = Math.max(0, Number(exp) || 0);
  let lvl = 1;
  for (let i = WEALTH_THRESHOLDS.length - 1; i >= 0; i--) {
    if (safeExp >= WEALTH_THRESHOLDS[i].requiredExp) {
      lvl = WEALTH_THRESHOLDS[i].level;
      break;
    }
  }
  return lvl;
};

export const getWealthExpRequired = (level: number): number => {
  const entry = WEALTH_THRESHOLDS.find((t) => t.level === level);
  return entry ? entry.requiredExp : 0;
};

export const calculateWealthProgress = (exp: number): LevelProgressResult => {
  const safeExp = Math.max(0, Number(exp) || 0);
  const currentLvl = calculateWealthLevel(safeExp);
  const currentMeta = WEALTH_THRESHOLDS.find((t) => t.level === currentLvl) || WEALTH_THRESHOLDS[0];
  const nextMeta = WEALTH_THRESHOLDS.find((t) => t.level === currentLvl + 1);

  if (!nextMeta) {
    // Max level reached
    return {
      level: currentLvl,
      currentExp: safeExp,
      nextLevelExp: currentMeta.requiredExp,
      floorExp: currentMeta.requiredExp,
      remainingExp: 0,
      progressPercent: 100,
      isMaxLevel: true,
      tier: currentMeta.tier,
      badgeIcon: currentMeta.badgeIcon,
      color: currentMeta.color,
    };
  }

  const floorExp = currentMeta.requiredExp;
  const nextLevelExp = nextMeta.requiredExp;
  const remainingExp = Math.max(0, nextLevelExp - safeExp);

  // Reference UI displays: Current EXP: safeExp / nextLevelExp
  // Progress bar visual is safeExp / nextLevelExp or bracket progress
  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round((safeExp / nextLevelExp) * 100))
  );

  return {
    level: currentLvl,
    currentExp: safeExp,
    nextLevelExp,
    floorExp,
    remainingExp,
    progressPercent,
    isMaxLevel: false,
    tier: currentMeta.tier,
    badgeIcon: currentMeta.badgeIcon,
    color: currentMeta.color,
  };
};

export const getWealthRemainingExp = (exp: number): number => {
  return calculateWealthProgress(exp).remainingExp;
};

export const getWealthRewards = (level: number): LevelRewardItem[] => {
  return WEALTH_REWARDS.filter((r) => r.requiredLevel <= level);
};

export const calculateCharmLevel = (exp: number): number => {
  const safeExp = Math.max(0, Number(exp) || 0);
  let lvl = 1;
  for (let i = CHARM_THRESHOLDS.length - 1; i >= 0; i--) {
    if (safeExp >= CHARM_THRESHOLDS[i].requiredExp) {
      lvl = CHARM_THRESHOLDS[i].level;
      break;
    }
  }
  return lvl;
};

export const getCharmExpRequired = (level: number): number => {
  const entry = CHARM_THRESHOLDS.find((t) => t.level === level);
  return entry ? entry.requiredExp : 0;
};

export const calculateCharmProgress = (exp: number): LevelProgressResult => {
  const safeExp = Math.max(0, Number(exp) || 0);
  const currentLvl = calculateCharmLevel(safeExp);
  const currentMeta = CHARM_THRESHOLDS.find((t) => t.level === currentLvl) || CHARM_THRESHOLDS[0];
  const nextMeta = CHARM_THRESHOLDS.find((t) => t.level === currentLvl + 1);

  if (!nextMeta) {
    return {
      level: currentLvl,
      currentExp: safeExp,
      nextLevelExp: currentMeta.requiredExp,
      floorExp: currentMeta.requiredExp,
      remainingExp: 0,
      progressPercent: 100,
      isMaxLevel: true,
      tier: currentMeta.tier,
      badgeIcon: currentMeta.badgeIcon,
      color: currentMeta.color,
    };
  }

  const floorExp = currentMeta.requiredExp;
  const nextLevelExp = nextMeta.requiredExp;
  const remainingExp = Math.max(0, nextLevelExp - safeExp);
  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round((safeExp / nextLevelExp) * 100))
  );

  return {
    level: currentLvl,
    currentExp: safeExp,
    nextLevelExp,
    floorExp,
    remainingExp,
    progressPercent,
    isMaxLevel: false,
    tier: currentMeta.tier,
    badgeIcon: currentMeta.badgeIcon,
    color: currentMeta.color,
  };
};

export const getCharmRemainingExp = (exp: number): number => {
  return calculateCharmProgress(exp).remainingExp;
};

export const getCharmRewards = (level: number): LevelRewardItem[] => {
  const result: LevelRewardItem[] = [];
  for (const m of CHARM_MILESTONES) {
    if (m <= level && CHARM_PACKAGES[m]) {
      result.push(...CHARM_PACKAGES[m]);
    }
  }
  return result;
};

// Level Range Groups Generator (Lv 1-9, Lv 10-19, Lv 20-29...)
export interface LevelRangeGroup {
  id: string;
  label: string;
  startLevel: number;
  endLevel: number;
  isUnlocked: boolean;
  isCurrent: boolean;
}

export const generateWealthLevelRanges = (currentLevel: number): LevelRangeGroup[] => {
  const groups: LevelRangeGroup[] = [
    { id: 'r_1_9', label: 'Lv 1–9', startLevel: 1, endLevel: 9, isUnlocked: currentLevel >= 1, isCurrent: currentLevel >= 1 && currentLevel <= 9 },
    { id: 'r_10_19', label: 'Lv 10–19', startLevel: 10, endLevel: 19, isUnlocked: currentLevel >= 10, isCurrent: currentLevel >= 10 && currentLevel <= 19 },
    { id: 'r_20_29', label: 'Lv 20–29', startLevel: 20, endLevel: 29, isUnlocked: currentLevel >= 20, isCurrent: currentLevel >= 20 && currentLevel <= 29 },
    { id: 'r_30_39', label: 'Lv 30–39', startLevel: 30, endLevel: 39, isUnlocked: currentLevel >= 30, isCurrent: currentLevel >= 30 && currentLevel <= 39 },
    { id: 'r_40_49', label: 'Lv 40–49', startLevel: 40, endLevel: 49, isUnlocked: currentLevel >= 40, isCurrent: currentLevel >= 40 && currentLevel <= 49 },
    { id: 'r_50_59', label: 'Lv 50–59', startLevel: 50, endLevel: 59, isUnlocked: currentLevel >= 50, isCurrent: currentLevel >= 50 && currentLevel <= 59 },
    { id: 'r_60_69', label: 'Lv 60–69', startLevel: 60, endLevel: 69, isUnlocked: currentLevel >= 60, isCurrent: currentLevel >= 60 && currentLevel <= 69 },
    { id: 'r_70_79', label: 'Lv 70–79', startLevel: 70, endLevel: 79, isUnlocked: currentLevel >= 70, isCurrent: currentLevel >= 70 && currentLevel <= 79 },
    { id: 'r_80_89', label: 'Lv 80–89', startLevel: 80, endLevel: 89, isUnlocked: currentLevel >= 80, isCurrent: currentLevel >= 80 && currentLevel <= 89 },
    { id: 'r_90_99', label: 'Lv 90–99', startLevel: 90, endLevel: 99, isUnlocked: currentLevel >= 90, isCurrent: currentLevel >= 90 && currentLevel <= 99 },
    { id: 'r_100_109', label: 'Lv 100–109', startLevel: 100, endLevel: 109, isUnlocked: currentLevel >= 100, isCurrent: currentLevel >= 100 && currentLevel <= 109 },
    { id: 'r_110_119', label: 'Lv 110–119', startLevel: 110, endLevel: 119, isUnlocked: currentLevel >= 110, isCurrent: currentLevel >= 110 && currentLevel <= 119 },
    { id: 'r_120_129', label: 'Lv 120–129', startLevel: 120, endLevel: 129, isUnlocked: currentLevel >= 120, isCurrent: currentLevel >= 120 && currentLevel <= 129 },
    { id: 'r_130_139', label: 'Lv 130–139', startLevel: 130, endLevel: 139, isUnlocked: currentLevel >= 130, isCurrent: currentLevel >= 130 && currentLevel <= 139 },
    { id: 'r_140_150', label: 'Lv 140–150', startLevel: 140, endLevel: 150, isUnlocked: currentLevel >= 140, isCurrent: currentLevel >= 140 && currentLevel <= 150 },
  ];
  return groups;
};
