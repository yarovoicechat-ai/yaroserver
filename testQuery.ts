import mongoose from 'mongoose';
import { connectDB } from './src/utils/db';

connectDB()
  .then(async () => {
    const UserSchema = new mongoose.Schema({}, { strict: false, collection: 'users' });
    const User = mongoose.model('User', UserSchema);

    const email = 'deepak@operator.com';
    const admin = await User.findOne({
      email,
      role: { $in: ['owner', 'operator', 'superAdmin', 'admin', 'agency', 'coinSeller'] }
    }) as any;
    console.log('Result without isDeleted:', admin ? { name: admin.name, isDeleted: admin.isDeleted } : 'null');

    const admin2 = await User.findOne({
      email,
      role: { $in: ['owner', 'operator', 'superAdmin', 'admin', 'agency', 'coinSeller'] },
      isDeleted: false
    }) as any;
    console.log('Result with isDeleted: false:', admin2 ? admin2.name : 'null');

    await mongoose.disconnect();
  });
