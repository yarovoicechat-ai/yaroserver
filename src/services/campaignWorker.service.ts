import { Campaign, ICampaign } from '../models/campaign.model';
import { User } from '../models/user.model';
import Notification from '../models/notification.model';
import { sendPushNotification } from '../utils/pushNotification';
import { getIO } from '../sockets';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class CampaignWorkerService {
    /**
     * Build MongoDB query from campaign targeting parameters
     */
    static buildTargetingFilter(targeting: ICampaign['targeting']): any {
        const filter: any = { isDeleted: false, isBlocked: false };

        // Country filter
        if (targeting.country && targeting.country.length > 0 && !targeting.country.includes('ALL') && !targeting.country.includes('*')) {
            filter['country.code'] = { $in: targeting.country };
        }

        // Gender filter
        if (targeting.gender && targeting.gender !== 'ALL') {
            filter.gender = targeting.gender;
        }

        // Level filter
        if (targeting.minLevel && targeting.minLevel > 1) {
            filter.level = { $gte: Number(targeting.minLevel) };
        }

        // VIP filter
        if (targeting.vipOnly) {
            filter.level = { $gte: 10 };
        }

        // Role filter
        if (targeting.roleSegment && targeting.roleSegment !== 'ALL') {
            const roleMap: Record<string, string> = {
                'HOSTS': 'host',
                'AGENCIES': 'agency',
                'SELLERS': 'coinSeller',
                'USERS': 'user'
            };
            if (roleMap[targeting.roleSegment]) {
                filter.role = roleMap[targeting.roleSegment];
            }
        }

        // Activity status
        const now = Date.now();
        if (targeting.activityStatus === 'ACTIVE_7D') {
            filter.lastActiveAt = { $gte: new Date(now - 7 * 86400000) };
        } else if (targeting.activityStatus === 'INACTIVE_30D') {
            filter.lastActiveAt = { $lt: new Date(now - 30 * 86400000) };
        }

        return filter;
    }

    /**
     * Execute an asynchronous batch dispatch of a campaign
     */
    static async processCampaign(campaignId: string): Promise<void> {
        const campaign = await Campaign.findById(campaignId);
        if (!campaign || ['COMPLETED', 'CANCELLED'].includes(campaign.status)) {
            return;
        }

        campaign.status = 'RUNNING';
        campaign.startedAt = new Date();
        await campaign.save();

        try {
            const filter = this.buildTargetingFilter(campaign.targeting);

            // Channel: SYSTEM_BROADCAST
            if (campaign.channel === 'SYSTEM_BROADCAST') {
                try {
                    const io = getIO();
                    if (io) {
                        io.emit('system_announcement', {
                            id: campaign._id,
                            title: campaign.title,
                            message: campaign.message,
                            timestamp: new Date()
                        });
                    }
                    const activeCount = await User.countDocuments(filter);
                    campaign.metrics.sent = activeCount;
                    campaign.metrics.delivered = activeCount;
                    campaign.status = 'COMPLETED';
                    campaign.completedAt = new Date();
                    await campaign.save();
                    return;
                } catch (socketErr: any) {
                    console.warn('Socket broadcast warning:', socketErr.message);
                }
            }

            // Channel: PUSH_FCM or IN_APP
            const targetedUsers = await User.find(filter)
                .select('_id userId fcmToken')
                .lean();

            campaign.metrics.sent = targetedUsers.length;
            await campaign.save();

            let deliveredCount = 0;
            let failedCount = 0;

            if (campaign.channel === 'PUSH_FCM') {
                // Collect valid FCM tokens
                const validTokens = targetedUsers
                    .map(u => u.fcmToken)
                    .filter((t): t is string => Boolean(t && t.length > 20));

                const BATCH_SIZE = 250;
                for (let i = 0; i < validTokens.length; i += BATCH_SIZE) {
                    // Check if campaign was cancelled mid-flight
                    const check = await Campaign.findById(campaignId).select('status');
                    if (check?.status === 'CANCELLED') {
                        break;
                    }

                    const chunk = validTokens.slice(i, i + BATCH_SIZE);
                    try {
                        const result = await sendPushNotification(chunk, {
                            title: campaign.title,
                            body: campaign.message,
                            data: {
                                campaignId: String(campaign._id),
                                click_action: 'FLUTTER_NOTIFICATION_CLICK'
                            }
                        });

                        if (result?.success) {
                            deliveredCount += chunk.length;
                        } else {
                            failedCount += chunk.length;
                        }
                    } catch {
                        failedCount += chunk.length;
                    }

                    campaign.metrics.delivered = deliveredCount;
                    campaign.metrics.failed = failedCount;
                    await campaign.save();

                    // Throttle batch chunks
                    await sleep(150);
                }
            } else if (campaign.channel === 'IN_APP') {
                // Bulk insert into Notification collection
                const notificationDocs = targetedUsers.map(u => ({
                    userId: u._id,
                    title: campaign.title,
                    message: campaign.message,
                    type: 'system' as any,
                    isRead: false,
                    createdAt: new Date()
                }));

                const BATCH_SIZE = 500;
                for (let i = 0; i < notificationDocs.length; i += BATCH_SIZE) {
                    const chunk = notificationDocs.slice(i, i + BATCH_SIZE);
                    try {
                        await Notification.insertMany(chunk, { ordered: false });
                        deliveredCount += chunk.length;
                    } catch {
                        failedCount += chunk.length;
                    }
                    await sleep(100);
                }
            }

            campaign.status = 'COMPLETED';
            campaign.completedAt = new Date();
            campaign.metrics.delivered = deliveredCount;
            campaign.metrics.failed = failedCount;
            await campaign.save();

        } catch (err: any) {
            campaign.status = 'FAILED';
            campaign.failureReason = err.message;
            campaign.completedAt = new Date();
            await campaign.save();
        }
    }
}
