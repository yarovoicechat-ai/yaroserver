import { initializeSuperAdmin } from "../controllers/adminController";
import HostLevel from "../models/hostLevel.model";
import { User } from "../models/user.model";
import { UserRole, Gender, AuthType } from "../constants/user";
import { generateSecureHash } from "./passwordHelper";
import { generateUniqueId } from "./generator";
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

export const initializeOfficialReviewAccount = async (): Promise<void> => {
  try {
    const reviewPhoneDigits = "9999999999";
    const plainPassword = "password123";
    const hashedPassword = await generateSecureHash(plainPassword);

    const existingUser = await User.findOne({
      $or: [
        { phoneNumber: reviewPhoneDigits },
        { phoneNumber: `+91${reviewPhoneDigits}` },
        { phoneNumber: new RegExp(`${reviewPhoneDigits}$`) },
      ],
    }).select("+password");

    if (existingUser) {
      existingUser.name = "Yaro Official Review";
      existingUser.phoneNumber = `+91${reviewPhoneDigits}`;
      existingUser.password = hashedPassword;
      if (existingUser.role === 'owner') {
        existingUser.role = UserRole.USER;
      }
      existingUser.isActive = true;
      existingUser.isBlocked = false;
      existingUser.isDeleted = false;
      existingUser.phoneVerified = true;
      existingUser.profileCompleted = true;
      existingUser.mustChangePassword = false;
      if (!existingUser.diamonds || existingUser.diamonds < 100000) existingUser.diamonds = 100000;
      if (!existingUser.coins || existingUser.coins < 100000) existingUser.coins = 100000;
      await existingUser.save();
      console.info(`[ReviewAccount] Official review account updated: ${reviewPhoneDigits} / ${plainPassword}`);
    } else {
      const newUserId = await generateUniqueId();
      const reviewUser = new User({
        userId: newUserId,
        name: "Yaro Official Review",
        phoneNumber: `+91${reviewPhoneDigits}`,
        password: hashedPassword,
        role: UserRole.USER,
        gender: Gender.MALE,
        authType: AuthType.PHONE,
        image: "https://api.yaroapp.in/uploads/avatars/male_default.webp",
        isActive: true,
        isBlocked: false,
        isDeleted: false,
        phoneVerified: true,
        profileCompleted: true,
        welcomeRewardClaimed: true,
        diamonds: 100000,
        coins: 100000,
        device: {
          createdDeviceId: "official_review_device",
          currentDeviceId: "official_review_device",
          loggedInDeviceIds: ["official_review_device"],
        },
      });
      await reviewUser.save();
      console.info(`[ReviewAccount] Official review account created (ID: ${newUserId}, Phone: +91${reviewPhoneDigits}, Password: ${plainPassword}).`);
    }
  } catch (error) {
    console.error(`[ReviewAccount] Error initializing official review account: ${sanitizeMongoError(error)}`);
  }
};

export const initializeDatabase = async (): Promise<void> => {
  await connectDB();
  await initializeSuperAdmin();
  await seedDefaultHostLevels();
  await initializeOfficialReviewAccount();
};
