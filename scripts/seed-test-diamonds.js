const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/yaro';
const ENABLE_TEST_DIAMONDS = process.env.ENABLE_TEST_DIAMONDS === 'true' || process.env.NODE_ENV !== 'production';

async function seedTestDiamonds() {
  if (!ENABLE_TEST_DIAMONDS) {
    console.error('❌ Refusing to run: ENABLE_TEST_DIAMONDS must be set to true and NODE_ENV cannot be production.');
    process.exit(1);
  }

  console.log('💎 Connecting to MongoDB for Test Diamond Seeding...');
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB.');

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection failed');
  }

  const usersCollection = db.collection('users');
  const userCount = await usersCollection.countDocuments();
  console.log(`📊 Found ${userCount} users in database.`);

  const result = await usersCollection.updateMany(
    {
      $or: [
        { diamonds: { $lt: 1000000 } },
        { diamonds: { $exists: false } },
        { diamonds: null },
      ],
    },
    {
      $set: {
        diamonds: 1000000,
      },
    }
  );

  console.log(`🎉 Successfully credited 1,000,000 Diamonds to ${result.modifiedCount} users!`);

  // Ensure default test users
  const testPhoneNumbers = ['+919999999901', '+919999999902', '+919999999903'];
  const testNames = ['Test Host', 'VIP Tester', 'Guest Sender'];

  for (let i = 0; i < testPhoneNumbers.length; i++) {
    const existing = await usersCollection.findOne({ phoneNumber: testPhoneNumbers[i] });
    if (!existing) {
      const nextId = 20000000 + i;
      await usersCollection.insertOne({
        userId: nextId,
        name: testNames[i],
        phoneNumber: testPhoneNumbers[i],
        gender: i % 2 === 0 ? 'female' : 'male',
        role: i === 0 ? 'host' : 'user',
        diamonds: 1000000,
        coins: 100000,
        level: (i + 1) * 3,
        status: 'Active',
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`👤 Created test user: ${testNames[i]} (${testPhoneNumbers[i]}) with 1,000,000 💎`);
    }
  }

  console.log('✨ Seed complete! Disconnecting...');
  await mongoose.disconnect();
  console.log('👋 Done.');
}

seedTestDiamonds().catch((err) => {
  console.error('Fatal error seeding diamonds:', err);
  process.exit(1);
});
