import { Request, Response } from "express";
import { Logger } from "../utils/logger";
import { PricePlan } from "../models/coinsPrice.model";
import sendResponse from "../utils/reponse";
import { AuthRequest } from "../middlewares/authorize.middleware";
import { UserRole } from "../constants/user";

const DEFAULT_RECHARGE_PLANS = [
  {
    title: "Starter Diamond Pack",
    description: "Get 100 Diamonds instantly",
    actualPrice: 99,
    discountedPrice: 79,
    coins: 100,
    diamonds: 100,
    bonusCoins: 10,
    badge: "STARTER",
    productId: "yaro_diamonds_100",
    type: "online",
    isActive: true,
    sortOrder: 1,
    currency: "INR",
  },
  {
    title: "Popular Diamond Chest",
    description: "Get 500 Diamonds + 50 Bonus",
    actualPrice: 499,
    discountedPrice: 399,
    coins: 500,
    diamonds: 500,
    bonusCoins: 50,
    badge: "POPULAR",
    productId: "yaro_diamonds_500",
    type: "online",
    isActive: true,
    sortOrder: 2,
    currency: "INR",
  },
  {
    title: "VIP Gamer Vault",
    description: "Get 1,000 Diamonds + 150 Bonus",
    actualPrice: 999,
    discountedPrice: 799,
    coins: 1000,
    diamonds: 1000,
    bonusCoins: 150,
    badge: "BEST VALUE",
    productId: "yaro_diamonds_1000",
    type: "online",
    isActive: true,
    sortOrder: 3,
    currency: "INR",
  },
  {
    title: "Royal Emperor Trove",
    description: "Get 2,500 Diamonds + 500 Bonus",
    actualPrice: 2499,
    discountedPrice: 1999,
    coins: 2500,
    diamonds: 2500,
    bonusCoins: 500,
    badge: "HOT",
    productId: "yaro_diamonds_2500",
    type: "online",
    isActive: true,
    sortOrder: 4,
    currency: "INR",
  },
  {
    title: "Mega Whale Reserve",
    description: "Get 5,000 Diamonds + 1,200 Bonus",
    actualPrice: 4999,
    discountedPrice: 3999,
    coins: 5000,
    diamonds: 5000,
    bonusCoins: 1200,
    badge: "SUPREME",
    productId: "yaro_diamonds_5000",
    type: "online",
    isActive: true,
    sortOrder: 5,
    currency: "INR",
  },
  {
    title: "Seller Agent Bulk Pack",
    description: "10,000 Diamonds for Seller Distribution",
    actualPrice: 9000,
    discountedPrice: 8500,
    coins: 10000,
    diamonds: 1000,
    bonusCoins: 1500,
    badge: "SELLER ONLY",
    productId: "yaro_bulk_seller_10000",
    type: "offline",
    isActive: true,
    sortOrder: 6,
    currency: "INR",
  },
];

export const addPricePlan = async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.user || {};
    if (role && ![UserRole.SUPER_ADMIN, UserRole.ADMIN, 'owner', 'operator'].includes(role as any)) {
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
    if (role && ![UserRole.SUPER_ADMIN, UserRole.ADMIN, 'owner', 'operator'].includes(role as any)) {
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
    if (role && ![UserRole.SUPER_ADMIN, UserRole.ADMIN, 'owner', 'operator'].includes(role as any)) {
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


