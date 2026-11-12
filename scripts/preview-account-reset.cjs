const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(path.join(root, 'node_modules/dotenv')).config({ path: path.join(root, '.env'), quiet: true });
const mongoose = require(path.join(root, 'node_modules/mongoose'));
(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri || new URL(uri).pathname !== '/yaro_live') throw new Error('EXPECTED_YARO_LIVE_DATABASE');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
  const db = mongoose.connection.db;
  const totals = await db.collection('users').aggregate([{ $group: {
    _id: null, accounts: { $sum: 1 }, coins: { $sum: '$coins' }, diamonds: { $sum: '$diamonds' },
    wealthExp: { $sum: '$wealthExp' }, charmExp: { $sum: '$charmExp' },
    equippedFrames: { $sum: { $cond: [{ $ifNull: ['$equippedFrame', false] }, 1, 0] } },
    inventoryItems: { $sum: { $size: { $ifNull: ['$storeInventory', []] } } },
  } }]).toArray();
  const roles = await db.collection('users').aggregate([{ $group: { _id: '$role', accounts: { $sum: 1 } } }]).toArray();
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(n => /economy|vip|entitle|level|medal|badge|inventory|wallet|withdraw|asset|hostmonth/i.test(n));
  const report = { database: db.databaseName, totals, roles, relatedCollections: collections };
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
})().catch(error => { console.error('Preview failed:', error.name, error.message === 'EXPECTED_YARO_LIVE_DATABASE' ? error.message : 'Database unavailable; connection details omitted'); process.exitCode = 1; });
