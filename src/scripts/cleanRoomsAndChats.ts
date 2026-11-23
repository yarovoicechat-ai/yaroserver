import mongoose from 'mongoose';
import { Room } from '../models/room.model';
import Message from '../models/chat.model';
import Conversation from '../models/conversation.model';
import redis from '../configs/redisConfig';
import { config } from '../configs/envConfig';

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(config.MONGODB_URI || 'mongodb://127.0.0.1:27017/yaro');
  console.log('Connected to MongoDB.');

  // 1. Clean all voice rooms
  const roomsDeleted = await Room.deleteMany({});
  console.log(`Deleted ${roomsDeleted.deletedCount || 0} voice rooms.`);

  // 2. Clear Redis voice room cache
  try {
    const keys = await redis.keys('voice_room:*');
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`Deleted ${keys.length} voice_room Redis keys.`);
    } else {
      console.log('No voice_room keys in Redis.');
    }
  } catch (err) {
    console.warn('Redis key cleanup warning:', err);
  }

  // 3. Clean all chat messages and conversations
  const msgDeleted = await Message.deleteMany({});
  const convDeleted = await Conversation.deleteMany({});
  console.log(`Deleted ${msgDeleted.deletedCount || 0} messages and ${convDeleted.deletedCount || 0} conversations.`);

  console.log('Cleanup completed successfully. New rooms will start from 9-digit series 100000000.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Cleanup error:', err);
  process.exit(1);
});
