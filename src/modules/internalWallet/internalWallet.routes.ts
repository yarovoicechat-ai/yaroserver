import { Router } from 'express';
import { InternalWalletController } from './internalWallet.controller';
import { internalServiceAuth } from './internalWallet.middleware';

const router = Router();

// Enforce service-to-service authentication on all internal wallet routes
router.use(internalServiceAuth);

router.post('/debit', InternalWalletController.debit);
router.post('/credit', InternalWalletController.credit);
router.get('/balance/:userId', InternalWalletController.getBalance);

export default router;
