import mongoose from 'mongoose';
import { VipAssets } from '../models/vipAssets.model';
import { getVipAssets } from '../utils/vipAssets';

export class VipAssetsService {
  static async list() {
    // Only initialize missing levels. Management edits always take precedence.
    await VipAssets.bulkWrite([1, 2, 3, 4, 5].map(level => ({ updateOne: {
      filter: { level },
      update: { $setOnInsert: { level, ...getVipAssets(level) } },
      upsert: true,
    } })));
    return VipAssets.find().sort({ level: 1 }).lean();
  }

  static async resolve(level: number) {
    const defaults = getVipAssets(level);
    if (!defaults) return null;
    const saved: any = mongoose.connection.readyState === 1
      ? await VipAssets.findOne({ level }).lean() : null;
    if (!saved) return defaults;
    return {
      frame: saved.frame.isActive === false ? null : saved.frame,
      entry: saved.entry.isActive === false ? null : { ...defaults.entry, ...saved.entry },
    };
  }
}
