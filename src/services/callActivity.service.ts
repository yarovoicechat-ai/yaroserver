import Notification from '../models/notification.model';
import redis from '../configs/redisConfig';
import { withDistributedLock } from '../utils/distributedLock';
import {
  CallActivityRecipient,
  CallActivityStatus,
  getCallActivityContent,
} from '../utils/callActivityRules';

export interface CallActivityUpdate {
  userId: string;
  transactionId: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

export const upsertCallActivity = async ({ userId, transactionId, title, message, data = {} }: CallActivityUpdate) => {
  return withDistributedLock(redis, `call_activity:${String(userId)}:${String(transactionId)}`, async () =>
    Notification.findOneAndUpdate(
      { userId, type: 'call', 'data.transactionId': String(transactionId) },
      {
        $set: {
          title,
          message,
          data: { ...data, transactionId: String(transactionId) },
        },
        // A repeated lifecycle update changes the existing row without
        // turning a notification the user has read back into an unread item.
        $setOnInsert: { userId, type: 'call', isRead: false },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ),
  { ttlMs: 15_000, waitMs: 2_000 });
};

export const recordCallActivityState = async (args: {
  userId: string;
  transactionId: string;
  recipient: CallActivityRecipient;
  status: CallActivityStatus;
  peerId: string;
  peerName?: string;
  peerImage?: string;
}) => {
  const content = getCallActivityContent(args.status, args.recipient, args.peerName || '');
  return upsertCallActivity({
    userId: args.userId,
    transactionId: args.transactionId,
    ...content,
    data: {
      callStatus: args.status,
      targetUserId: args.peerId,
      targetName: args.peerName || (args.recipient === 'caller' ? 'Host' : 'Caller'),
      targetImage: args.peerImage || '',
    },
  });
};
