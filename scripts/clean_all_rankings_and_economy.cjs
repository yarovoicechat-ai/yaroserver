require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri || !uri.includes('yaro_live')) {
    throw new Error('Script must run against yaro_live database only.');
  }

  console.log('Connecting to MongoDB Atlas yaro_live...');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  console.log('Connected to database:', db.databaseName);

  // 1. Delete Gift Transactions
  const giftRes = await db.collection('gifttransactions').deleteMany({});
  console.log(`Deleted gifttransactions: ${giftRes.deletedCount}`);

  // 2. Delete Coins Transactions
  const coinRes = await db.collection('coinstransactions').deleteMany({});
  console.log(`Deleted coinstransactions: ${coinRes.deletedCount}`);

  // 3. Delete Room Contributions
  const roomRes = await db.collection('roomcontributions').deleteMany({});
  console.log(`Deleted roomcontributions: ${roomRes.deletedCount}`);

  // 4. Delete Spent Coins
  const spentRes = await db.collection('spentcoins').deleteMany({});
  console.log(`Deleted spentcoins: ${spentRes.deletedCount}`);

  // 5. Reset LiveBroadcasts top contributors and gift counts
  const liveRes = await db.collection('livebroadcasts').updateMany(
    {},
    {
      $set: {
        topContributors: [],
        diamonds: 0,
        coins: 0,
        totalGifts: 0,
        giftsCount: 0,
      }
    }
  );
  console.log(`Updated livebroadcasts: ${liveRes.modifiedCount}`);

  // 6. Reset all users ranking EXP, levels, coins and diamonds
  // All regular users set to 0 coins/beans, 0 diamonds/coins, level 1
  // Review account (userId: 1000000001) gets 10,000 test coins for Google Play review
  const usersRes = await db.collection('users').updateMany(
    { userId: { $ne: 1000000001 } },
    {
      $set: {
        coins: 0,
        diamonds: 0,
        wealthExp: 0,
        wealthLevel: 1,
        charmExp: 0,
        charmLevel: 1,
        level: 1,
      }
    }
  );
  console.log(`Reset regular users: ${usersRes.modifiedCount}`);

  // Official review account
  await db.collection('users').updateOne(
    { userId: 1000000001 },
    {
      $set: {
        coins: 0,
        diamonds: 10000,
        wealthExp: 0,
        wealthLevel: 1,
        charmExp: 0,
        charmLevel: 1,
        level: 1,
      }
    }
  );
  console.log('Set review account userId 1000000001 to 10,000 test coins, 0 EXP');

  // 7. Verify post totals
  const totals = await db.collection('users').aggregate([
    {
      $group: {
        _id: null,
        totalUsers: { $sum: 1 },
        totalCoins: { $sum: '$coins' },
        totalDiamonds: { $sum: '$diamonds' },
        totalWealthExp: { $sum: '$wealthExp' },
        totalCharmExp: { $sum: '$charmExp' },
      }
    }
  ]).toArray();
  console.log('Post-clean totals:', JSON.stringify(totals, null, 2));

  console.log('ALL RANKINGS, GIFTS, COINS AND LEADERBOARDS CLEANED SUCCESSFULLY.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Clean error:', err);
  process.exit(1);
});
