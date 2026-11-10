import { GOOGLE_PLAY_PRODUCT_IDS, GOOGLE_PLAY_PRODUCTS } from "../constants/googlePlayProducts";
import { Request, Response } from "express";
import { Logger } from "../utils/logger";
import { PricePlan } from "../models/coinsPrice.model";
import sendResponse from "../utils/reponse";
import { AuthRequest } from "../middlewares/authorize.middleware";
import { UserRole } from "../constants/user";

export const DEFAULT_RECHARGE_PLANS = [
  // --- 10 Online Recharge Plans (Rate: ₹100 = 7,200 Coins, ₹1 = 72 Coins) ---
  {
    title: "Plan 1 (₹10)",
    description: "Get 720 Coins instantly",
    actualPrice: 10,
    discountedPrice: 10,
    coins: 720,
    diamonds: 720,
    bonusCoins: 0,
    badge: "STARTER",
    productId: "coins_720",
    type: "online",
    isActive: true,
    sortOrder: 1,
    currency: "INR",
  },
  {
    title: "Plan 2 (₹50)",
    description: "Get 3,600 Coins",
    actualPrice: 50,
    discountedPrice: 50,
    coins: 3600,
    diamonds: 3600,
    bonusCoins: 0,
    badge: "",
    productId: "coins_3600",
    type: "online",
    isActive: true,
    sortOrder: 2,
    currency: "INR",
  },
  {
    title: "Plan 3 (₹100)",
    description: "Get 7,200 Coins",
    actualPrice: 100,
    discountedPrice: 100,
    coins: 7200,
    diamonds: 7200,
    bonusCoins: 0,
    badge: "POPULAR",
    productId: "coins_7200",
    type: "online",
    isActive: true,
    sortOrder: 3,
    currency: "INR",
  },
  {
    title: "Plan 4 (₹200)",
    description: "Get 14,400 Coins",
    actualPrice: 200,
    discountedPrice: 200,
    coins: 14400,
    diamonds: 14400,
    bonusCoins: 0,
    badge: "",
    productId: "coins_14400",
    type: "online",
    isActive: true,
    sortOrder: 4,
    currency: "INR",
  },
  {
    title: "Plan 5 (₹500)",
    description: "Get 36,000 Coins",
    actualPrice: 500,
    discountedPrice: 500,
    coins: 36000,
    diamonds: 36000,
    bonusCoins: 0,
    badge: "BEST VALUE",
    productId: "coins_36000",
    type: "online",
    isActive: true,
    sortOrder: 5,
    currency: "INR",
  },
  {
    title: "Plan 6 (₹1,000)",
    description: "Get 72,000 Coins",
    actualPrice: 1000,
    discountedPrice: 1000,
    coins: 72000,
    diamonds: 72000,
    bonusCoins: 0,
    badge: "HOT",
    productId: "coins_72000",
    type: "online",
    isActive: true,
    sortOrder: 6,
    currency: "INR",
  },
  {
    title: "Plan 7 (₹2,000)",
    description: "Get 1,44,000 Coins",
    actualPrice: 2000,
    discountedPrice: 2000,
    coins: 144000,
    diamonds: 144000,
    bonusCoins: 0,
    badge: "",
    productId: "coins_144000",
    type: "online",
    isActive: true,
    sortOrder: 7,
    currency: "INR",
  },
  {
    title: "Plan 8 (₹5,000)",
    description: "Get 3,60,000 Coins",
    actualPrice: 5000,
    discountedPrice: 5000,
    coins: 360000,
    diamonds: 360000,
    bonusCoins: 0,
    badge: "VIP",
    productId: "coins_360000",
    type: "online",
    isActive: true,
    sortOrder: 8,
    currency: "INR",
  },
  {
    title: "Plan 9 (₹10,000)",
    description: "Get 7,20,000 Coins",
    actualPrice: 10000,
    discountedPrice: 10000,
    coins: 720000,
    diamonds: 720000,
    bonusCoins: 0,
    badge: "ROYAL",
    productId: "coins_720000",
    type: "online",
    isActive: true,
    sortOrder: 9,
    currency: "INR",
  },
  {
    title: "Plan 10 (₹20,000)",
    description: "Get 14,40,000 Coins",
    actualPrice: 20000,
    discountedPrice: 20000,
    coins: 1440000,
    diamonds: 1440000,
    bonusCoins: 0,
    badge: "SUPREME",
    productId: "coins_1440000",
    type: "online",
    isActive: true,
    sortOrder: 10,
    currency: "INR",
  },

  // --- 10 Offline Recharge Plans (Rate: ₹100 = 10,000 Coins, ₹1 = 100 Coins) ---
  {
    title: "Offline Plan 1 (₹10)",
    description: "Get 1,000 Coins via Offline Recharge",
    actualPrice: 10,
    discountedPrice: 10,
    coins: 1000,
    diamonds: 1000,
    bonusCoins: 0,
    badge: "OFFLINE",
    productId: "offline_10",
    type: "offline",
    isActive: true,
    sortOrder: 101,
    currency: "INR",
  },
  {
    title: "Offline Plan 2 (₹50)",
    description: "Get 5,000 Coins via Offline Recharge",
    actualPrice: 50,
    discountedPrice: 50,
    coins: 5000,
    diamonds: 5000,
    bonusCoins: 0,
    badge: "",
    productId: "offline_50",
    type: "offline",
    isActive: true,
    sortOrder: 102,
    currency: "INR",
  },
  {
    title: "Offline Plan 3 (₹100)",
    description: "Get 10,000 Coins via Offline Recharge",
    actualPrice: 100,
    discountedPrice: 100,
    coins: 10000,
    diamonds: 10000,
    bonusCoins: 0,
    badge: "POPULAR",
    productId: "offline_100",
    type: "offline",
    isActive: true,
    sortOrder: 103,
    currency: "INR",
  },
  {
    title: "Offline Plan 4 (₹200)",
    description: "Get 20,000 Coins via Offline Recharge",
    actualPrice: 200,
    discountedPrice: 200,
    coins: 20000,
    diamonds: 20000,
    bonusCoins: 0,
    badge: "",
    productId: "offline_200",
    type: "offline",
    isActive: true,
    sortOrder: 104,
    currency: "INR",
  },
  {
    title: "Offline Plan 5 (₹500)",
    description: "Get 50,000 Coins via Offline Recharge",
    actualPrice: 500,
    discountedPrice: 500,
    coins: 50000,
    diamonds: 50000,
    bonusCoins: 0,
    badge: "BEST VALUE",
    productId: "offline_500",
    type: "offline",
    isActive: true,
    sortOrder: 105,
    currency: "INR",
  },
  {
    title: "Offline Plan 6 (₹1,000)",
    description: "Get 1,00,000 Coins via Offline Recharge",
    actualPrice: 1000,
    discountedPrice: 1000,
    coins: 100000,
    diamonds: 100000,
    bonusCoins: 0,
    badge: "HOT",
    productId: "offline_1000",
    type: "offline",
    isActive: true,
    sortOrder: 106,
    currency: "INR",
  },
  {
    title: "Offline Plan 7 (₹2,000)",
    description: "Get 2,00,000 Coins via Offline Recharge",
    actualPrice: 2000,
    discountedPrice: 2000,
    coins: 200000,
    diamonds: 200000,
    bonusCoins: 0,
    badge: "",
    productId: "offline_2000",
    type: "offline",
    isActive: true,
    sortOrder: 107,
    currency: "INR",
  },
  {
    title: "Offline Plan 8 (₹5,000)",
    description: "Get 5,00,000 Coins via Offline Recharge",
    actualPrice: 5000,
    discountedPrice: 5000,
    coins: 500000,
    diamonds: 500000,
    bonusCoins: 0,
    badge: "VIP",
    productId: "offline_5000",
    type: "offline",
    isActive: true,
    sortOrder: 108,
    currency: "INR",
  },
  {
    title: "Offline Plan 9 (₹10,000)",
    description: "Get 10,00,000 Coins via Offline Recharge",
    actualPrice: 10000,
    discountedPrice: 10000,
    coins: 1000000,
    diamonds: 1000000,
    bonusCoins: 0,
    badge: "ROYAL",
    productId: "offline_10000",
    type: "offline",
    isActive: true,
    sortOrder: 109,
    currency: "INR",
  },
  {
    title: "Offline Plan 10 (₹20,000)",
    description: "Get 20,00,000 Coins via Offline Recharge",
    actualPrice: 20000,
    discountedPrice: 20000,
    coins: 2000000,
    diamonds: 2000000,
    bonusCoins: 0,
    badge: "SUPREME",
    productId: "offline_20000",
    type: "offline",
    isActive: true,
    sortOrder: 110,
    currency: "INR",
  },
];

export const getPublicPricePlans = (_req: Request, res: Response) => {
  const plans = GOOGLE_PLAY_PRODUCT_IDS.map(productId => ({
    productId,
    coins: GOOGLE_PLAY_PRODUCTS[productId].coins,
    diamonds: GOOGLE_PLAY_PRODUCTS[productId].diamonds,
    priceInr: GOOGLE_PLAY_PRODUCTS[productId].priceInr,
    formattedPrice: GOOGLE_PLAY_PRODUCTS[productId].formattedPrice,
    type: 'google_play',
    billingProvider: 'google_play',
  }));
  return sendResponse(res, 200, true, 'Online packages', { plans, total: plans.length });
};

export const addPricePlan = async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.user || {};
    if (!role || ![UserRole.SUPER_ADMIN, UserRole.ADMIN, 'owner', 'operator'].includes(role as any)) {
      return sendResponse(res, 403, false, "Forbidden: Access denied");
    }

    const {
      title,
      description,
      actualPrice,
      discountedPrice = 0,
      coins,
      diamonds,
      bonusCoins = 0,
      badge = "",
      productId = "",
      type = "online",
      icon = "",
      isActive = true,
      sortOrder = 0,
      currency = "INR",
    } = req.body;

    const coinsVal = Number(coins || diamonds || 0);
    const actualPriceVal = Number(actualPrice || 0);

    if (!description || !actualPriceVal || !coinsVal) {
      return sendResponse(
        res,
        400,
        false,
        "Required fields: description, actualPrice, coins/diamonds"
      );
    }

    const newPlan = await PricePlan.create({
      title: title || `${coinsVal} Diamonds Pack`,
      description,
      actualPrice: actualPriceVal,
      discountedPrice: Number(discountedPrice || 0),
      coins: coinsVal,
      diamonds: Number(diamonds || coinsVal),
      bonusCoins: Number(bonusCoins || 0),
      badge,
      productId,
      type,
      icon,
      isActive: Boolean(isActive),
      sortOrder: Number(sortOrder || 0),
      currency: currency || "INR",
    });

    return sendResponse(res, 201, true, "Price plan added successfully", newPlan);
  } catch (error: any) {
    await Logger("addPricePlan", error);
    return sendResponse(res, 500, false, "Something went wrong", error?.message || error);
  }
};

export const getAllPricePlans = async (req: Request, res: Response) => {
  try {
    const { type, isActive, all } = req.query as any;

    // Check if initial seeding or migration to updated plans is needed
    const count = await PricePlan.countDocuments();
    const hasStarter = await PricePlan.findOne({ coins: 720 });
    if (count === 0 || !hasStarter) {
      for (const p of DEFAULT_RECHARGE_PLANS) {
        await PricePlan.findOneAndUpdate(
          { productId: p.productId },
          { $set: p },
          { upsert: true, new: true }
        );
      }
    }

    const query: any = {};
    if (type && type !== 'all') query.type = type;
    if (isActive !== undefined && isActive !== '') {
      query.isActive = isActive === 'true' || isActive === true;
    }

    if (all === 'true' || all === true) {
      const plans = await PricePlan.find(query).sort({ sortOrder: 1, actualPrice: 1 });
      return sendResponse(res, 200, true, "Price plans fetched successfully", {
        plans,
        total: plans.length,
      });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    const [plans, total] = await Promise.all([
      PricePlan.find(query).sort({ sortOrder: 1, actualPrice: 1 }).skip(skip).limit(limit),
      PricePlan.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limit);

    return sendResponse(
      res,
      200,
      true,
      total ? "Price plans fetched successfully" : "No price plans found",
      {
        plans,
        pagination: { total, page, limit, totalPages },
      }
    );
  } catch (error: any) {
    await Logger("getAllPricePlans", error);
    return sendResponse(res, 500, false, "Failed to get price plans", error.message);
  }
};

export const getPricePlanById = async (req: Request, res: Response) => {
  try {
    const plan = await PricePlan.findById(req.params.id);
    if (!plan) {
      return sendResponse(res, 404, false, "Price plan not found");
    }
    return sendResponse(res, 200, true, "Price plan fetched successfully", plan);
  } catch (error: any) {
    await Logger("getPricePlanById", error);
    return sendResponse(res, 500, false, "Failed to fetch price plan", error.message);
  }
};

export const updatePricePlan = async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.user || {};
    if (!role || ![UserRole.SUPER_ADMIN, UserRole.ADMIN, 'owner', 'operator'].includes(role as any)) {
      return sendResponse(res, 403, false, "Forbidden: Access denied");
    }

    const updateData: any = { ...req.body };
    if (updateData.coins && !updateData.diamonds) {
      updateData.diamonds = updateData.coins;
    } else if (updateData.diamonds && !updateData.coins) {
      updateData.coins = updateData.diamonds;
    }

    const updatedPlan = await PricePlan.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    if (!updatedPlan) {
      return sendResponse(res, 404, false, "Price plan not found");
    }

    return sendResponse(res, 200, true, "Price plan updated successfully", updatedPlan);
  } catch (error: any) {
    await Logger("updatePricePlan", error);
    return sendResponse(res, 500, false, "Failed to update price plan", error.message);
  }
};

export const togglePricePlanStatus = async (req: AuthRequest, res: Response) => {
  try {
    const plan = await PricePlan.findById(req.params.id);
    if (!plan) {
      return sendResponse(res, 404, false, "Price plan not found");
    }

    plan.isActive = !plan.isActive;
    await plan.save();

    return sendResponse(res, 200, true, `Price plan ${plan.isActive ? 'activated' : 'deactivated'}`, plan);
  } catch (error: any) {
    await Logger("togglePricePlanStatus", error);
    return sendResponse(res, 500, false, "Failed to toggle status", error.message);
  }
};

export const deletePricePlan = async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.user || {};
    if (!role || ![UserRole.SUPER_ADMIN, UserRole.ADMIN, 'owner', 'operator'].includes(role as any)) {
      return sendResponse(res, 403, false, "Forbidden: Access denied");
    }

    const deletedPlan = await PricePlan.findByIdAndDelete(req.params.id);
    if (!deletedPlan) {
      return sendResponse(res, 404, false, "Price plan not found");
    }

    return sendResponse(res, 200, true, "Price plan deleted successfully");
  } catch (error: any) {
    await Logger("deletePricePlan", error);
    return sendResponse(res, 500, false, "Failed to delete price plan", error.message);
  }
};

export const syncDefaultRechargePlans = async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.user || {};
    if (!role || ![UserRole.SUPER_ADMIN, UserRole.ADMIN, 'owner', 'operator'].includes(role as any)) {
      return sendResponse(res, 403, false, "Forbidden: Access denied");
    }

    await PricePlan.deleteMany({ type: { $in: ['online', 'google_play'] } });
    const inserted = await PricePlan.insertMany(DEFAULT_RECHARGE_PLANS);

    return sendResponse(res, 200, true, "Recharge plans synced successfully with default 9 plans", {
      count: inserted.length,
      plans: inserted,
    });
  } catch (error: any) {
    await Logger("syncDefaultRechargePlans", error);
    return sendResponse(res, 500, false, "Failed to sync recharge plans", error.message);
  }
};



