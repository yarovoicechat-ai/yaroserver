require('ts-node/register/transpile-only');
const { connectDB } = require('./src/utils/db');
const mongoose = require('mongoose');

connectDB()
  .then(async () => {
    const UserSchema = new mongoose.Schema({}, { strict: false, collection: 'users' });
    const User = mongoose.model('User', UserSchema);

    const email = 'deepak@operator.com';
    const res = await User.updateOne(
      { email },
      { 
        $set: { 
          isDeleted: false,
          isBlocked: false,
          isActive: true,
          device: {
            createdDeviceId: 'SYSTEM_GEN',
            currentDeviceId: 'SYSTEM_GEN',
            loggedInDeviceIds: ['SYSTEM_GEN']
          }
        } 
      }
    );

    console.log('Update result for Deepak:', res);
    await mongoose.disconnect();
  });
