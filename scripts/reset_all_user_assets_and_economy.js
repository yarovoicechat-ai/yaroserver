const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(path.join(root, 'node_modules/dotenv')).config({ path: path.join(root, '.env'), quiet: true });
const mongoose = require(path.join(root, 'node_modules/mongoose'));

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri || new URL(uri).pathname !== '/yaro_live') {
    throw new Error('Script must run against yaro_live database only.');
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000 });
  const db = mongoose.connection.db;

  const usersCount = await db.collection('users').countDocuments();
  console.log(`Found ${usersCount} users in database ${db.databaseName}.`);

  const resetFields = {
    // Balances
    coins: 0,
    diamonds: 0,

    // Levels & EXP
    level: 1,
    wealthLevel: 1,
    wealthExp: 0,
    charmLevel: 1,
    charmExp: 0,
    claimedLevelRewards: [],

    // Frames
    frameId: '',
    equippedFrame: null,
    equippedFrameAsset: null,
    equippedAvatarFrame: null,
    equippedProfileFrame: null,
    equippedEntryFrame: null,

    // Badges & Tags
    equippedBadge: null,
    equippedBadgeAsset: null,
    equippedBadges: [],
    equippedTag: null,
    equippedTagAsset: null,
    equippedEntryTag: '',

    // Store Inventory & Assets
    storeInventory: [],
    equippedEntry: null,
    equippedEntryAsset: null,
    equippedTassel: null,
    equippedTasselAsset: null,
    equippedEntrance: null,
    equippedEntranceAsset: null,
    equippedEntryEffect: null,
    ownedEntryEffects: [],
    equippedVehicle: null,
    equippedVehicleAsset: null,
    equippedChatBubble: null,
    equippedChatBubbleAsset: null,
    equippedMicWave: null,
    equippedRoomTheme: null,
    equippedProfileBorder: null,
    equippedProfileBorderAsset: null,

    // VIP / SVIP
    isSvip: false,
    svipLevel: 0,
    equippedSvipId: null,
    equippedSvipExpiresAt: null,
    ownedSvipIds: [],
    equippedVipId: null,
    equippedVipExpiresAt: null,
    ownedVipIds: [],
    equippedCustomId: null,
    customDisplayId: null,
  };

  const updateResult = await db.collection('users').updateMany(
    {},
    {
      $set: resetFields,
      $unset: {
        levelRewardClaims: '',
      }
    }
  );

  console.log(`Users updated successfully:`, {
    matchedCount: updateResult.matchedCount,
    modifiedCount: updateResult.modifiedCount,
    acknowledged: updateResult.acknowledged,
  });

  // Revoke active identity entitlements
  const entResult = await db.collection('identityentitlements').updateMany(
    { status: 'active' },
    {
      $set: {
        status: 'revoked',
        revokedAt: new Date(),
        revokeReason: 'Reset requested by owner: reset all assets, frames, badges, coins, beans, diamonds and levels',
      }
    }
  );
  console.log(`Identity entitlements revoked:`, {
    matchedCount: entResult.matchedCount,
    modifiedCount: entResult.modifiedCount,
  });

  // Verification aggregate
  const postTotals = await db.collection('users').aggregate([
    {
      $group: {
        _id: null,
        totalUsers: { $sum: 1 },
        totalCoins: { $sum: '$coins' },
        totalDiamonds: { $sum: '$diamonds' },
        totalWealthExp: { $sum: '$wealthExp' },
        totalCharmExp: { $sum: '$charmExp' },
        equippedFramesCount: { $sum: { $cond: [{ $ifNull: ['$equippedFrame', false] }, 1, 0] } },
        inventoryItemsCount: { $sum: { $size: { $ifNull: ['$storeInventory', []] } } },
      }
    }
  ]).toArray();

  console.log('Post-reset verification totals:', JSON.stringify(postTotals, null, 2));

  await mongoose.disconnect();
  console.log('Database reset completed safely. All user IDs and accounts preserved.');
}

run().catch((err) => {
  console.error('Reset script error:', err);
  process.exit(1);
});

