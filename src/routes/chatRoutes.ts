import { verifyToken } from './../middlewares/authorize.middleware';
import { Router } from "express";
import {
  sendMessageController,
  getMessagesController,
  getConversationsController,
  markMessagesSeenController,
  deleteSeenMessagesController,
  deleteMessageController,
  deleteConversationController,
  createConversationController,
} from "../controllers/chatController";

const router = Router();

// Send a message
router.post("/send", verifyToken, sendMessageController);
router.post("/send-message", verifyToken, sendMessageController);

// Get messages of a conversation
router.get("/messages", verifyToken, getMessagesController);

// Get conversation list of logged in user
router.get("/conversations", verifyToken, getConversationsController);
router.post("/conversations", verifyToken, createConversationController);

// Mark messages as seen
router.post("/seen", verifyToken, markMessagesSeenController);

// 👑 Delete seen messages (Owner only)
router.delete("/seen", verifyToken, deleteSeenMessagesController);

// 👑 Owner only: Delete individual message or full conversation
router.delete("/messages/:id", verifyToken, deleteMessageController);
router.delete("/conversations/:id", verifyToken, deleteConversationController);

export default router;
