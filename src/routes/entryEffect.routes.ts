import express from 'express';
import { verifyToken } from '../middlewares/authorize.middleware';
import { EntryEffectController } from '../controllers/entryEffect.controller';

export const entryEffectRouter = express.Router();

// GET /api/entry-effects - List available entry effects & ownership
entryEffectRouter.get('/', verifyToken, EntryEffectController.getEntryEffects);

// POST /api/entry-effects/purchase - Purchase with Diamonds
entryEffectRouter.post('/purchase', verifyToken, EntryEffectController.purchaseEffect);

// POST /api/entry-effects/equip - Equip or unequip
entryEffectRouter.post('/equip', verifyToken, EntryEffectController.equipEffect);

// POST /api/entry-effects/broadcast - Broadcast entry event to room
entryEffectRouter.post('/broadcast', verifyToken, EntryEffectController.broadcastEntry);

// Admin Endpoints
entryEffectRouter.get('/admin/all', EntryEffectController.getAllAdminEffects);
entryEffectRouter.post('/', verifyToken, EntryEffectController.createEffect);
entryEffectRouter.put('/:id', verifyToken, EntryEffectController.updateEffect);
entryEffectRouter.delete('/:id', verifyToken, EntryEffectController.deleteEffect);
entryEffectRouter.patch('/:id/toggle', verifyToken, EntryEffectController.toggleEffect);

export default entryEffectRouter;
