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

    const users = await User.find({ isDeleted: false }).select('userId name gender image role').lean();
    console.log(`Total users found: ${users.length}`);

    const imageTypes = new Map<string, number>();

    users.forEach(u => {
      const img = u.image || '(NULL/EMPTY)';
      imageTypes.set(img, (imageTypes.get(img) || 0) + 1);
    });

    console.log('\n--- IMAGE VALUE DISTRIBUTION ---');
    imageTypes.forEach((count, img) => {
      console.log(`Count: ${count} | Image: "${img}"`);
    });

    console.log('\n--- SAMPLE 15 USERS ---');
    users.slice(0, 15).forEach(u => {
      console.log(`[#${u.userId}] Name: ${u.name} | Gender: ${u.gender} | Role: ${u.role} | Image: "${u.image}"`);
    });

    process.exit(0);
  } catch (err) {
    console.error('Error dumping user images:', err);
    process.exit(1);
  }
}

run();
