import express from 'express';
import { EmojiController } from '../controllers/emoji.controller';
import { verifyToken } from '../middlewares/authorize.middleware';

export const emojiRouter = express.Router();

// Public endpoint for mobile app & web to fetch room emojis
emojiRouter.get('/', EmojiController.getEmojis);

// Admin endpoints
emojiRouter.get('/admin/all', verifyToken, EmojiController.getAdminEmojis);
emojiRouter.post('/', verifyToken, EmojiController.upsertEmoji);
emojiRouter.delete('/:id', verifyToken, EmojiController.deleteEmoji);

export default emojiRouter;

