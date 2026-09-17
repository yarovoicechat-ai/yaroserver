import { initializeSuperAdmin } from "../controllers/adminController";
import HostLevel from "../models/hostLevel.model";
import { connectDB, sanitizeMongoError } from "./db";

const seedDefaultHostLevels = async (): Promise<void> => {
  try {
    const count = await HostLevel.countDocuments();
    if (count === 0) {
      await HostLevel.insertMany([
        { level: 1, name: "Basic", minCalls: 80, minMinutes: 120, coinPerMinute: 25 },
        { level: 2, name: "Copper", minCalls: 110, minMinutes: 200, coinPerMinute: 30 },
        { level: 3, name: "Bronze", minCalls: 160, minMinutes: 330, coinPerMinute: 36 },
        { level: 4, name: "Silver", minCalls: 220, minMinutes: 500, coinPerMinute: 42 },
        { level: 5, name: "Gold", minCalls: 300, minMinutes: 700, coinPerMinute: 48 },
        { level: 6, name: "Platinum", minCalls: 400, minMinutes: 950, coinPerMinute: 54 },
        { level: 7, name: "Diamond", minCalls: 500, minMinutes: 1200, coinPerMinute: 60 },
        { level: 8, name: "Grand Master", minCalls: 600, minMinutes: 1500, coinPerMinute: 66 },
      ]);
      console.info("Auto-seeded default HostLevel rules 1..8");
    }
  } catch (error) {
    console.error(`Error seeding HostLevels: ${sanitizeMongoError(error)}`);
  }
};

export const initializeDatabase = async (): Promise<void> => {
  await connectDB();
  await initializeSuperAdmin();
  await seedDefaultHostLevels();
};
