require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI;
  console.log('Connecting to MongoDB URI:', uri ? uri.replace(/:([^:@]+)@/, ':****@') : 'NONE');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  console.log('Database name:', db.databaseName);

  const collections = ['gifttransactions', 'coinstransactions', 'roomcontributions', 'spentcoins', 'livebroadcasts', 'users'];
  for (const c of collections) {
    try {
      const count = await db.collection(c).countDocuments();
      console.log(`Collection ${c}: ${count} documents`);
    } catch (e) {
      console.log(`Collection ${c}: error: ${e.message}`);
    }
  }

  const sampleUsers = await db.collection('users').find({}, { projection: { name: 1, userId: 1, role: 1, coins: 1, diamonds: 1, wealthExp: 1, charmExp: 1 } }).limit(5).toArray();
  console.log('Sample users:', JSON.stringify(sampleUsers, null, 2));

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
