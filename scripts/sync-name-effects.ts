import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import dns from 'dns';
import { IdentityEffect } from '../src/models/identityEffect.model';
import { NAME_EFFECT_PRESETS } from '../src/utils/nameEffectPresets';

try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (_) {}

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not defined in .env');
  process.exit(1);
}

async function syncNameEffects() {
  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(MONGODB_URI!);
  console.log('✅ Connected to MongoDB.');

  console.log(`Syncing ${NAME_EFFECT_PRESETS.length} Name Effect presets...`);

  const ops = NAME_EFFECT_PRESETS.map((preset) => ({
    updateOne: {
      filter: { slug: preset.slug },
      update: { $set: preset },
      upsert: true,
    },
  }));

  const result = await IdentityEffect.bulkWrite(ops);
  console.log(`✅ Bulk write completed:`, {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    upsertedCount: result.upsertedCount,
  });

  const totalInDb = await IdentityEffect.countDocuments({ 'metadata.panelOnly': true });
  console.log(`🎉 Total panel Name Effects in database: ${totalInDb}`);

  const sample = await IdentityEffect.find({ 'metadata.panelOnly': true })
    .select('name slug config.animationType')
    .sort({ sortOrder: 1 })
    .limit(10);
  console.log('Sample presets in DB:', sample.map(s => `${s.name} (${s.slug}) [${s.config?.animationType}]`));

  await mongoose.disconnect();
  console.log('Done.');
}

syncNameEffects().catch((err) => {
  console.error('❌ Error syncing name effects:', err);
  process.exit(1);
});
