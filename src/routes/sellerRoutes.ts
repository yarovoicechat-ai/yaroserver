import { Router, Response, NextFunction } from 'express';
import { verifyToken, AuthRequest } from '../middlewares/authorize.middleware';
import sendResponse from '../utils/reponse';
import {
    verifyUserForSeller,
    rechargeUserBySeller,
    getSellerDashboard,
    getSellerHistory,
    getSellerLedger,
    requestStockBySeller,
    getSellerStockRequests,
    getSellerConfig
} from '../controllers/sellerController';

const router = Router();

// Middleware: Strictly require coinSeller or Admin role to prevent ordinary user bypass
const requireSellerRole = (req: AuthRequest, res: Response, next: NextFunction) => {
    const allowedRoles = ['coinSeller', 'admin', 'superAdmin', 'owner'];
    if (!req.user || !allowedRoles.includes(req.user.role)) {
        return sendResponse(res, 403, false, "Access denied: Seller authorization required.");
    }
    next();
};

// Protected Seller Portal Endpoints - enforce both JWT verification and Seller/Admin role
router.use(verifyToken);
router.use(requireSellerRole);

router.get('/config', getSellerConfig);
router.get('/users/:userId', verifyUserForSeller);
router.post('/recharge', rechargeUserBySeller);
router.get('/dashboard', getSellerDashboard);
router.get('/history', getSellerHistory);
router.get('/ledger', getSellerLedger);
router.post('/stock/request', requestStockBySeller);
router.get('/stock/requests', getSellerStockRequests);

export default router;
