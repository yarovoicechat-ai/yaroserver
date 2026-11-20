import { Router } from 'express';
import { GameController } from './game.controller';
import { verifyToken } from '../../middlewares/authorize.middleware';

const router = Router();

// Game Catalog
router.get('/', verifyToken, GameController.getAllGames);

// Game Sessions
router.post('/session', verifyToken, GameController.createOrJoinSession);
router.post('/session/ticket', verifyToken, GameController.createOrJoinSession);
router.get('/session/:id', verifyToken, GameController.getSession);
router.post('/session/:id/join', verifyToken, GameController.joinSession);
router.post('/session/:id/leave', verifyToken, GameController.leaveSession);
router.post('/session/:id/bet', verifyToken, GameController.placeBet);
router.post('/session/:id/result', verifyToken, GameController.settleRound);

// Game Wallet
router.get('/wallet', verifyToken, GameController.getWallet);

export default router;
