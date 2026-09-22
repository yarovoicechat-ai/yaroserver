import { User } from '../models/user.model';
import { ISegmentRules } from '../models/segment.model';

export class SegmentationService {
    /**
     * Convert segment definition rules into an indexed MongoDB filter for User collection
     */
    static buildFilter(rules: ISegmentRules): any {
        const filter: any = { isDeleted: false, isBlocked: false };

        if (rules.country && rules.country.length > 0 && !rules.country.includes('ALL') && !rules.country.includes('*')) {
            filter['country.code'] = { $in: rules.country };
        }

        if (rules.gender && rules.gender !== 'ALL') {
            filter.gender = rules.gender;
        }

        if (rules.minLevel && rules.minLevel > 1) {
            filter.level = { $gte: Number(rules.minLevel) };
        }

        if (rules.vipOnly) {
            filter.level = { $gte: 10 };
        }

        if (rules.roleSegment && rules.roleSegment !== 'ALL') {
            const roleMap: Record<string, string> = {
                'HOSTS': 'host',
                'AGENCIES': 'agency',
                'SELLERS': 'coinSeller',
                'USERS': 'user'
            };
            if (roleMap[rules.roleSegment]) {
                filter.role = roleMap[rules.roleSegment];
            }
        }

        const now = Date.now();
        if (rules.activeWithinDays && rules.activeWithinDays > 0) {
            filter.lastActiveAt = { $gte: new Date(now - rules.activeWithinDays * 86400000) };
        }

        if (rules.inactiveForDays && rules.inactiveForDays > 0) {
            filter.lastActiveAt = { $lt: new Date(now - rules.inactiveForDays * 86400000) };
        }

        if (rules.minCoinsRecharged && rules.minCoinsRecharged > 0) {
            filter.coins = { $gte: Number(rules.minCoinsRecharged) };
        }

        return filter;
    }

    /**
     * Compute count of matching users with maxTimeMS timeout protection
     */
    static async calculateCount(rules: ISegmentRules): Promise<number> {
        const filter = this.buildFilter(rules);
        return await User.countDocuments(filter).maxTimeMS(4000);
    }

    /**
     * Retrieve paginated users matching segment rules
     */
    static async getUsers(rules: ISegmentRules, page = 1, limit = 20) {
        const filter = this.buildFilter(rules);
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));

        const [users, total] = await Promise.all([
            User.find(filter)
                .select('_id userId name gender level coins country lastActiveAt role image')
                .sort({ lastActiveAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            User.countDocuments(filter).maxTimeMS(3000)
        ]);

        return {
            users,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            }
        };
    }
}
