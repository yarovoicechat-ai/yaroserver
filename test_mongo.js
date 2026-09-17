const mongoose = require('mongoose');

const uri = 'mongodb+srv://yaro_live:vxh5KCR35qY7TXd4@cluster0.fkdii3e.mongodb.net/yaro_live?retryWrites=true&w=majority&appName=Cluster0';

async function testConn() {
  console.log('Testing mongoose connection...');
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('Connection SUCCESS!');
    process.exit(0);
  } catch (err) {
    console.error('Connection FAILED:', err);
    process.exit(1);
  }
}

testConn();
