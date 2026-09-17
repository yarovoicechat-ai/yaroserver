import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDB } from './src/utils/db';

connectDB()
  .then(async () => {
    console.log('Connected to MongoDB');

    const UserSchema = new mongoose.Schema({
      userId: { type: Number },
      name: { type: String },
      email: { type: String },
      password: { type: String },
      role: { type: String },
      isBlocked: { type: Boolean }
    }, { collection: 'users' });

    const User = mongoose.model('User', UserSchema);

    const email = 'deepak@operator.com';
    const plainPassword = 'deepak123';

    const user = await User.findOne({ email }) as any;
    if (!user) {
      console.log('❌ User not found in database!');
      await mongoose.disconnect();
      return;
    }

    console.log('User found:', user.name, 'Role:', user.role, 'Blocked:', user.isBlocked);
    console.log('Password hash in DB:', user.password);

    const isMatch = await bcrypt.compare(plainPassword, user.password);
    console.log('Bcrypt compare result for "deepak123":', isMatch);

    await mongoose.disconnect();
  })
  .catch((err: any) => {
    console.error('Error:', err);
  });
