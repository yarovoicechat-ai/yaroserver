import { Request, Response } from 'express';
import { BeansPlan } from '../models/beansPlan.model';
import sendResponse from '../utils/reponse';
import { AuthRequest } from '../middlewares/authorize.middleware';
import { UserRole } from '../constants/user';
import { Logger } from '../utils/logger';

const DEFAULT_BEANS_PLANS = [
  {
    name: '1,000 Beans Exchange',
    beans: 1000,
    diamonds: 900,
    bonusDiamonds: 0,
    price: 100,
    badge: 'STARTER',
    type: 'exchange',
    description: 'Convert 1,000 Beans into 900 Diamonds instantly',
    isActive: true,
    sortOrder: 1,
  },
  {
    name: '2,000 Beans Exchange',
    beans: 2000,
    diamonds: 1800,
    bonusDiamonds: 50,
    price: 200,
    badge: 'POPULAR',
    type: 'exchange',
    description: 'Convert 2,000 Beans into 1,800 Diamonds + 50 Bonus',
    isActive: true,
    sortOrder: 2,
  },
  {
    name: '5,000 Beans Exchange',
    beans: 5000,
    diamonds: 4500,
    bonusDiamonds: 150,
    price: 500,
    badge: 'HOT',
    type: 'exchange',
    description: 'Convert 5,000 Beans into 4,500 Diamonds + 150 Bonus',
    isActive: true,
    sortOrder: 3,
  },
  {
    name: '10,000 Beans Exchange',
    beans: 10000,
    diamonds: 9000,
    bonusDiamonds: 400,
    price: 1000,
    badge: 'BEST VALUE',
    type: 'exchange',
    description: 'Convert 10,000 Beans into 9,000 Diamonds + 400 Bonus',
    isActive: true,
    sortOrder: 4,
  },
  {
    name: '20,000 Beans Exchange',
    beans: 20000,
    diamonds: 18000,
    bonusDiamonds: 1000,
    price: 2000,
    badge: 'MEGA PACK',
    type: 'exchange',
    description: 'Convert 20,000 Beans into 18,000 Diamonds + 1,000 Bonus',
    isActive: true,
    sortOrder: 5,
  },
  {
    name: '50,000 Beans Exchange',
    beans: 50000,
    diamonds: 45000,
    bonusDiamonds: 3000,
    price: 5000,
    badge: 'VIP PRO',
    type: 'exchange',
    description: 'Convert 50,000 Beans into 45,000 Diamonds + 3,000 Bonus',
    isActive: true,
    sortOrder: 6,
  },
  {
    name: '100,000 Beans Exchange',
    beans: 100000,
    diamonds: 90000,
    bonusDiamonds: 7000,
    price: 10000,
    badge: 'ROYAL CHEST',
    type: 'exchange',
    description: 'Convert 100,000 Beans into 90,000 Diamonds + 7,000 Bonus',
    isActive: true,
    sortOrder: 7,
  },
  {
    name: '200,000 Beans Exchange',
    beans: 200000,
    diamonds: 180000,
    bonusDiamonds: 15000,
    price: 20000,
    badge: 'SUPREME',
    type: 'exchange',
    description: 'Convert 200,000 Beans into 180,000 Diamonds + 15,000 Bonus',
    isActive: true,
    sortOrder: 8,
  },
  {
    name: '500,000 Beans Exchange',
    beans: 500000,
    diamonds: 450000,
    bonusDiamonds: 45000,
    price: 50000,
    badge: 'WHALE VAULT',
    type: 'exchange',
    description: 'Convert 500,000 Beans into 450,000 Diamonds + 45,000 Bonus',
    isActive: true,
    sortOrder: 9,
  },
];

export const getAllBeansPlans = async (req: Request, res: Response) => {
  try {
    const { type, isActive, all } = req.query as any;

    const count = await BeansPlan.countDocuments();
    if (count === 0) {
      await BeansPlan.insertMany(DEFAULT_BEANS_PLANS);
    }

    const query: any = {};
    if (type && type !== 'all') query.type = type;
    if (isActive !== undefined && isActive !== '') {
      query.isActive = isActive === 'true' || isActive === true;
    }

    if (all === 'true' || all === true) {
      const plans = await BeansPlan.find(query).sort({ sortOrder: 1, beans: 1 });
      return sendResponse(res, 200, true, 'Beans plans fetched successfully', {
        plans,
        total: plans.length,
      });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    const [plans, total] = await Promise.all([
      BeansPlan.find(query).sort({ sortOrder: 1, beans: 1 }).skip(skip).limit(limit),
      BeansPlan.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limit);

    return sendResponse(
      res,
      200,
      true,
      total ? 'Beans plans fetched successfully' : 'No beans plans found',
      {
        plans,
        pagination: { total, page, limit, totalPages },
      }
    );
  } catch (error: any) {
    await Logger('getAllBeansPlans', error);
    return sendResponse(res, 500, false, 'Failed to fetch beans plans', error.message);
  }
};

export const getBeansPlanById = async (req: Request, res: Response) => {
  try {
    const plan = await BeansPlan.findById(req.params.id);
    if (!plan) return sendResponse(res, 404, false, 'Beans plan not found');
    return sendResponse(res, 200, true, 'Beans plan fetched successfully', plan);
  } catch (error: any) {
    await Logger('getBeansPlanById', error);
    return sendResponse(res, 500, false, 'Failed to fetch beans plan', error.message);
  }
};

export const addBeansPlan = async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.user || {};
    if (role && ![UserRole.SUPER_ADMIN, UserRole.ADMIN, 'owner', 'operator'].includes(role as any)) {
      return sendResponse(res, 403, false, 'Forbidden: Access denied');
    }

    const {
      name,
      beans,
      diamonds,
      bonusDiamonds = 0,
      price = 0,
      currency = 'INR',
      badge = '',
      type = 'exchange',
      description = '',
      isActive = true,
      sortOrder = 0,
    } = req.body;

    const beansVal = Number(beans);
    const diamondsVal = Number(diamonds);

    if (!name || !beansVal || !diamondsVal) {
      return sendResponse(res, 400, false, 'Required fields: name, beans, diamonds');
    }

    const newPlan = await BeansPlan.create({
      name,
      beans: beansVal,
      diamonds: diamondsVal,
      bonusDiamonds: Number(bonusDiamonds || 0),
      price: Number(price || 0),
      currency: currency || 'INR',
      badge: badge || '',
      type: type || 'exchange',
      description: description || '',
      isActive: Boolean(isActive),
      sortOrder: Number(sortOrder || 0),
    });

    return sendResponse(res, 201, true, 'Beans plan created successfully', newPlan);
  } catch (error: any) {
    await Logger('addBeansPlan', error);
    return sendResponse(res, 500, false, 'Failed to create beans plan', error.message);
  }
};

export const updateBeansPlan = async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.user || {};
    if (role && ![UserRole.SUPER_ADMIN, UserRole.ADMIN, 'owner', 'operator'].includes(role as any)) {
      return sendResponse(res, 403, false, 'Forbidden: Access denied');
    }

    const updatedPlan = await BeansPlan.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!updatedPlan) {
      return sendResponse(res, 404, false, 'Beans plan not found');
    }

    return sendResponse(res, 200, true, 'Beans plan updated successfully', updatedPlan);
  } catch (error: any) {
    await Logger('updateBeansPlan', error);
    return sendResponse(res, 500, false, 'Failed to update beans plan', error.message);
  }
};

export const toggleBeansPlanStatus = async (req: AuthRequest, res: Response) => {
  try {
    const plan = await BeansPlan.findById(req.params.id);
    if (!plan) return sendResponse(res, 404, false, 'Beans plan not found');

    plan.isActive = !plan.isActive;
    await plan.save();

    return sendResponse(res, 200, true, `Beans plan ${plan.isActive ? 'activated' : 'deactivated'}`, plan);
  } catch (error: any) {
    await Logger('toggleBeansPlanStatus', error);
    return sendResponse(res, 500, false, 'Failed to toggle status', error.message);
  }
};

export const deleteBeansPlan = async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.user || {};
    if (role && ![UserRole.SUPER_ADMIN, UserRole.ADMIN, 'owner', 'operator'].includes(role as any)) {
      return sendResponse(res, 403, false, 'Forbidden: Access denied');
    }

    const deletedPlan = await BeansPlan.findByIdAndDelete(req.params.id);
    if (!deletedPlan) return sendResponse(res, 404, false, 'Beans plan not found');

    return sendResponse(res, 200, true, 'Beans plan deleted successfully');
  } catch (error: any) {
    await Logger('deleteBeansPlan', error);
    return sendResponse(res, 500, false, 'Failed to delete beans plan', error.message);
  }
};
