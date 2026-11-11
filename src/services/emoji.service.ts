import { Emoji, IEmoji } from '../models/emoji.model';
import { INITIAL_EMOJIS } from '../data/initialEmojis';

export class EmojiService {
  /**
   * Seed default emojis if database collection is empty
   */
  static async seedEmojisIfNeeded(): Promise<void> {
    try {
      const count = await Emoji.countDocuments();
      if (count === 0) {
        console.log('[EmojiService] Seeding default emojis into MongoDB...');
        for (const item of INITIAL_EMOJIS) {
          await Emoji.findOneAndUpdate(
            { code: item.code },
            {
              code: item.code,
              name: item.name,
              category: item.category,
              icon: item.icon,
              pngUrl: item.pngUrl,
              gifUrl: item.gifUrl,
              sortOrder: item.sortOrder,
              isActive: item.isActive,
            },
            { upsert: true, new: true }
          );
        }
        console.log(`[EmojiService] Successfully seeded ${INITIAL_EMOJIS.length} emojis.`);
      } else {
        // Migration: Ensure any existing emojis with old emoji_*.gif url are migrated to anim_emoji_*.gif
        const oldEntries = await Emoji.find({ gifUrl: { $regex: /\/emoji_[^/]+\.gif$/ } });
        if (oldEntries.length > 0) {
          for (const entry of oldEntries) {
            entry.gifUrl = entry.gifUrl.replace(/\/emoji_([^/]+\.gif)$/, '/anim_emoji_$1');
            await entry.save();
          }
          console.log(`[EmojiService] Migrated ${oldEntries.length} emoji gifUrls to anim_emoji format.`);
        }
      }
    } catch (err: any) {
      console.warn('[EmojiService] Auto-seed notice:', err?.message || err);
    }
  }

  /**
   * Retrieve active emojis grouped by category or as list
   */
  static async getActiveEmojis(): Promise<IEmoji[]> {
    await this.seedEmojisIfNeeded();
    const items = await Emoji.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
    if (!items || items.length === 0) {
      // Fallback to static seed if database returned empty
      return INITIAL_EMOJIS as any;
    }
    return items as any;
  }

  /**
   * Admin: Get all emojis including inactive
   */
  static async getAllAdminEmojis(): Promise<IEmoji[]> {
    await this.seedEmojisIfNeeded();
    return await Emoji.find().sort({ sortOrder: 1, createdAt: 1 }).lean() as any;
  }

  /**
   * Admin: Create or update emoji
   */
  static async upsertEmoji(data: any): Promise<IEmoji> {
    const code = String(data.code || data.name || '').trim().toLowerCase().replace(/\s+/g, '_');
    const query = data._id ? { _id: data._id } : { code };
    return await Emoji.findOneAndUpdate(
      query,
      {
        ...data,
        code,
        icon: data.icon || data.pngUrl,
        pngUrl: data.pngUrl || data.icon,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  /**
   * Admin: Delete emoji
   */
  static async deleteEmoji(id: string): Promise<boolean> {
    const res = await Emoji.findByIdAndDelete(id);
    return Boolean(res);
  }
}

