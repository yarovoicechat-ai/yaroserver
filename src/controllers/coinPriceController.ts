import { GOOGLE_PLAY_PRODUCT_IDS, GOOGLE_PLAY_PRODUCTS } from "../constants/googlePlayProducts";
import { Request, Response } from "express";
import { Logger } from "../utils/logger";
import { PricePlan } from "../models/coinsPrice.model";
import sendResponse from "../utils/reponse";
import { AuthRequest } from "../middlewares/authorize.middleware";
import { UserRole } from "../constants/user";

export const DEFAULT_RECHARGE_PLANS = [
  {
    title: "Starter Plan",
    description: "Get 7 Diamonds instantly",
    actualPrice: 10,
    discountedPrice: 10,
    coins: 7,
    diamonds: 7,
    bonusCoins: 0,
    badge: "STARTER",
    productId: "diamonds_7",
    type: "online",
    isActive: true,
    sortOrder: 1,
    currency: "INR",
  },
  {
    title: "Basic Plan",
    description: "Get 35 Diamonds",
    actualPrice: 49,
    discountedPrice: 49,
    coins: 35,
    diamonds: 35,
    bonusCoins: 0,
    badge: "",
    productId: "diamonds_35",
    type: "online",
    isActive: true,
    sortOrder: 2,
    currency: "INR",
  },
  {
    title: "Popular Plan",
    description: "Get 71 Diamonds",
    actualPrice: 99,
    discountedPrice: 99,
    coins: 71,
    diamonds: 71,
    bonusCoins: 0,
    badge: "POPULAR",
    productId: "diamonds_71",
    type: "online",
    isActive: true,
    sortOrder: 3,
    currency: "INR",
  },
  {
    title: "Standard Plan",
    description: "Get 143 Diamonds",
    actualPrice: 199,
    discountedPrice: 199,
    coins: 143,
    diamonds: 143,
    bonusCoins: 0,
    badge: "",
    productId: "diamonds_143",
    type: "online",
    isActive: true,
    sortOrder: 4,
    currency: "INR",
  },
  {
    title: "Plus Plan",
    description: "Get 215 Diamonds",
    actualPrice: 299,
    discountedPrice: 299,
    coins: 215,
    diamonds: 215,
    bonusCoins: 0,
    badge: "",
    productId: "diamonds_215",
    type: "online",
    isActive: true,
    sortOrder: 5,
    currency: "INR",
  },
  {
    title: "Pro Plan",
    description: "Get 359 Diamonds",
    actualPrice: 499,
    discountedPrice: 499,
    coins: 359,
    diamonds: 359,
    bonusCoins: 0,
    badge: "BEST VALUE",
    productId: "diamonds_359",
    type: "online",
    isActive: true,
    sortOrder: 6,
    currency: "INR",
  },
  {
    title: "Elite Plan",
    description: "Get 719 Diamonds",
    actualPrice: 999,
    discountedPrice: 999,
    coins: 719,
    diamonds: 719,
    bonusCoins: 0,
    badge: "HOT",
    productId: "diamonds_719",
    type: "online",
    isActive: true,
    sortOrder: 7,
    currency: "INR",
  },
  {
    title: "Master Plan",
    description: "Get 1,439 Diamonds",
    actualPrice: 1999,
    discountedPrice: 1999,
    coins: 1439,
    diamonds: 1439,
    bonusCoins: 0,
    badge: "SUPREME",
    productId: "diamonds_1439",
    type: "online",
    isActive: true,
    sortOrder: 8,
    currency: "INR",
  },
  {
    title: "Grand Whale Plan",
    description: "Get 3,599 Diamonds",
    actualPrice: 4999,
    discountedPrice: 4999,
    coins: 3599,
    diamonds: 3599,
    bonusCoins: 0,
    badge: "ROYAL",
    productId: "diamonds_3599",
    type: "online",
    isActive: true,
    sortOrder: 9,
    currency: "INR",
  },
];

export const getPublicPricePlans = (_req: Request, res: Response) => {
  const plans = GOOGLE_PLAY_PRODUCT_IDS.map(productId => ({ productId,
    diamonds: GOOGLE_PLAY_PRODUCTS[productId].diamonds, type: 'google_play', billingProvider: 'google_play' }));
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

    // Check if initial seeding is needed
    const count = await PricePlan.countDocuments();
    if (count === 0) {
      await PricePlan.insertMany(DEFAULT_RECHARGE_PLANS);
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



