import mongoose from 'mongoose';
import path from 'path';
import dotenv from 'dotenv';
import dns from 'dns';

try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {}

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || '';

async function run() {
  console.log('Connecting to MongoDB...');
  console.log('URI:', MONGODB_URI ? MONGODB_URI.replace(/:([^@]+)@/, ':****@') : 'MISSING');

  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
    });
    console.log('✅ Connected to MongoDB Atlas!');

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database object not found');
    }

    const users = db.collection('users');
    
    // Find Web Duniya
    const query = {
      $or: [
        { userId: 1000000002 },
        { userId: '1000000002' },
        { name: 'Web Duniya' }
      ]
    };

    let user = await users.findOne(query);
    console.log('Current user in DB:', user ? {
      _id: user._id,
      userId: user.userId,
      name: user.name,
      diamonds: user.diamonds,
      coins: user.coins
    } : 'NOT FOUND');

    if (user) {
      const updateRes = await users.updateOne(
        { _id: user._id },
        { $set: { diamonds: 100000000 } }
      );
      console.log('Update result:', updateRes);
      
      const updatedUser = await users.findOne({ _id: user._id });
      console.log('✅ Updated user:', {
        _id: updatedUser?._id,
        userId: updatedUser?.userId,
        name: updatedUser?.name,
        diamonds: updatedUser?.diamonds
      });
    } else {
      console.log('⚠️ User not found by query, searching all users for name containing "Web" or "Duniya" or id 1000000002...');
      const allMatches = await users.find({
        $or: [
          { name: /web/i },
          { name: /duniya/i },
          { userId: 1000000002 }
        ]
      }).toArray();
      console.log('Matches:', allMatches.map(u => ({ _id: u._id, userId: u.userId, name: u.name, diamonds: u.diamonds })));
    }

    await mongoose.disconnect();
    console.log('Done.');
  } catch (err: any) {
    console.error('❌ Connection or update error:', err);
  }
}

run();
