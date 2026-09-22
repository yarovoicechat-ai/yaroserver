import { connectDB } from "../utils/db";
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { User } from '../models/user.model';

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function run() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    const result = await User.updateMany(
      {
        image: {
          $in: [
            'https://api.yaroapp.in/uploads/avatars/male_default.webp',
            'https://api.yaroapp.in/uploads/avatars/female_default.webp',
            'https://api.yaroapp.in/uploads/avatars/neutral_default.webp',
            'https://api.voicecallclub.com/uploads/avatars/male_default.webp',
            'https://api.voicecallclub.com/uploads/avatars/female_default.webp',
            'https://api.voicecallclub.com/uploads/avatars/neutral_default.webp',
            '/uploads/avatars/female_default.webp',
            '/uploads/avatars/male_default.webp',
            '/uploads/avatars/neutral_default.webp'
          ]
        }
      },
      { $set: { image: '' } }
    );

    console.log(`Successfully cleaned up ${result.modifiedCount} users with 404 avatar URLs.`);
    process.exit(0);
  } catch (err) {
    console.error('Error cleaning DB default avatars:', err);
    process.exit(1);
  }
}

run();
