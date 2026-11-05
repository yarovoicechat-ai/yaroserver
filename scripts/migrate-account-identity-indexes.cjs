// Build stronger app/panel uniqueness constraints before removing old per-role indexes.
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { ACCOUNT_IDENTITY_INDEXES } = require('../dist/utils/accountScope');
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri || new URL(uri).pathname !== '/yaro_live') throw Error('Expected yaro_live');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 6000 });
  const users = mongoose.connection.collection('users');
  for (const { key, options } of ACCOUNT_IDENTITY_INDEXES) {
    const field = Object.keys(key)[0];
    const duplicates = await users.aggregate([
      { $match: options.partialFilterExpression },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }, { $count: 'groups' },
    ]).toArray();
    if (duplicates.length) throw Error(`${options.name}: duplicate groups require review; nothing is deleted`);
  }
  console.log('All four app/panel identity duplicate audits passed.');
  if (!process.argv.includes('--apply')) return;
  for (const { key, options } of ACCOUNT_IDENTITY_INDEXES) {
    await users.createIndex(key, options);
    console.log(`Verified index ${options.name}`);
  }
  const indexes = await users.indexes();
  for (const name of ['email_role_unique', 'phone_user_unique', 'phone_host_unique']) {
    if (indexes.some(i => i.name === name)) await users.dropIndex(name);
  }
  console.log('Scoped identity indexes installed; account records unchanged.');
}
main().catch(error => { console.error(error.code === 11000 ? 'Duplicate identities need review' : 'Identity migration failed'); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
