require('ts-node/register/transpile-only');
const { connectDB } = require('../utils/db');
const mongoose = require('mongoose');


async function main() {
  await connectDB();
  console.log("Connected DB");
  const db = mongoose.connection.db;

  const usersColl = db.collection('users');
  const count = await usersColl.countDocuments({});
  const activeCount = await usersColl.countDocuments({ isDeleted: { $ne: true } });
  console.log("TOTAL USERS IN DB:", count);
  console.log("ACTIVE USERS (isDeleted != true):", activeCount);

  const roles = await usersColl.aggregate([
    { $group: { _id: "$role", count: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ["$isDeleted", true] }, 0, 1] } } } }
  ]).toArray();
  console.log("ROLES BREAKDOWN:", JSON.stringify(roles, null, 2));

  // Simulate search queries
  const searchQueries = ["1000000014", "1000000", "+919876", "Priya", "Om", "Meethi"];
  
  for (const q of searchQueries) {
    const searchStr = q.trim();
    const escapedSearch = searchStr.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    const searchRegex = new RegExp(escapedSearch, 'i');
    const orConditions = [
      { name: searchRegex },
      { email: searchRegex },
      { userName: searchRegex },
      { phoneNumber: searchRegex },
      { meethiId: searchRegex },
      { employeeCode: searchRegex },
      { specialCode: searchRegex },
      { referralCode: searchRegex }
    ];
    if (!isNaN(Number(searchStr))) {
      orConditions.push({ userId: Number(searchStr) });
    }

    const res = await usersColl.find({ $or: orConditions }).project({ userId: 1, name: 1, phoneNumber: 1, meethiId: 1 }).toArray();
    console.log(`Search '${q}' -> Found ${res.length} matches:`, JSON.stringify(res.map(r => ({ userId: r.userId, name: r.name, phone: r.phoneNumber })), null, 2));
  }

  await mongoose.disconnect();
}

main().catch(console.error);
