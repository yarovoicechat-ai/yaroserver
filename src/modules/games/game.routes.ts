import { Router } from 'express';
import { GameController } from './game.controller';
import { verifyToken } from '../../middlewares/authorize.middleware';

const router = Router();

// Game Catalog & Client Visibility Config
router.get('/config', GameController.getGameConfig);
router.get('/', verifyToken, GameController.getAllGames);

// Admin Management
router.get('/admin/all', verifyToken, GameController.getAdminGames);
router.patch('/:gameId/status', verifyToken, GameController.updateGameStatus);
router.put('/:gameId/status', verifyToken, GameController.updateGameStatus);

// Game Sessions
router.post('/session', verifyToken, GameController.createOrJoinSession);
router.post('/session/ticket', verifyToken, GameController.createOrJoinSession);
router.get('/session/:id', verifyToken, GameController.getSession);
router.post('/session/:id/join', verifyToken, GameController.joinSession);
router.post('/session/:id/leave', verifyToken, GameController.leaveSession);
router.post('/session/:id/bet', verifyToken, GameController.placeBet);
router.post('/session/:id/payout', verifyToken, GameController.claimPayout);
router.post('/session/:id/result', verifyToken, GameController.settleRound);

// Game Wallet
router.get('/wallet', verifyToken, GameController.getWallet);

export default router;
