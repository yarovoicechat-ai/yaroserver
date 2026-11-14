
import cron from 'node-cron';
import { User } from '../models/user.model';
import { ChatQueueService } from './chatQueue.service';

/**
 * Chat Persistent Worker (Runs every 1s)
 */
export const startChatWorker = () => {
    setInterval(async () => {
        await ChatQueueService.flushQueue();
    }, 1000); // 1 second interval
};

export const startStaleHostCleanupJob = () => {
    cron.schedule('*/2 * * * *', async () => {
        try {
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            const staleFilter = {
                role: 'host',
                isActive: true,
                $and: [
                    { $or: [{ lastActiveAt: { $lt: twoHoursAgo } }, { lastActiveAt: { $exists: false } }] },
                    { $or: [{ lastOnline: { $lt: twoHoursAgo } }, { lastOnline: { $exists: false } }] },
                    { updatedAt: { $lt: twoHoursAgo } }
                ]
            };

            const result = await User.updateMany(staleFilter, { $set: { isActive: false, isOnline: false } });
            if (result.modifiedCount > 0) {
                console.log(`🧹 [HOST_CLEANUP] Deactivated ${result.modifiedCount} hosts due to 2 hours of app inactivity.`);
            }
        } catch (error) {
            console.error('Stale Host Cleanup Error:', error);
        }
    });
};
