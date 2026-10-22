/**
 * Database Seed Utility: 9 Official Recharge Plans
 *
 * Plan 1:  ₹10    -> 7 Diamonds
 * Plan 2:  ₹49    -> 35 Diamonds
 * Plan 3:  ₹99    -> 71 Diamonds (POPULAR)
 * Plan 4:  ₹199   -> 143 Diamonds
 * Plan 5:  ₹299   -> 215 Diamonds
 * Plan 6:  ₹499   -> 359 Diamonds (BEST VALUE)
 * Plan 7:  ₹999   -> 719 Diamonds (HOT)
 * Plan 8:  ₹1,999 -> 1,439 Diamonds (SUPREME)
 * Plan 9:  ₹4,999 -> 3,599 Diamonds (ROYAL)
 *
 * Usage:
 *   npx ts-node scripts/seed-recharge-plans.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import dns from 'dns';
import { PricePlan } from '../src/models/coinsPrice.model';
import { DEFAULT_RECHARGE_PLANS } from '../src/controllers/coinPriceController';

try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (_) {}

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  'mongodb://127.0.0.1:27017/yaro';

async function seedPlans() {
  console.log('💎 Connecting to MongoDB for Recharge Plans Seeding...');
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB.');

  console.log('🔄 Cleaning old online/google_play price plans...');
  await PricePlan.deleteMany({ type: { $in: ['online', 'google_play'] } });

  console.log(`📦 Inserting ${DEFAULT_RECHARGE_PLANS.length} official recharge plans...`);
  const inserted = await PricePlan.insertMany(DEFAULT_RECHARGE_PLANS);

  console.log(`\n🎉 Successfully seeded ${inserted.length} recharge plans:\n`);
  inserted.forEach((p, idx) => {
    console.log(
      `Plan ${idx + 1}: ${p.title} | Price: ₹${p.actualPrice} | Diamonds: ${p.diamonds} 💎 | SKU: ${p.productId}`
    );
  });

  await mongoose.disconnect();
  console.log('\n👋 Done.');
}

seedPlans().catch((err) => {
  console.error('❌ Error seeding plans:', err);
  process.exit(1);
});
