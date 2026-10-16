import { Request, Response } from "express";
import * as levelService from "../services/frame.service";
import { AuthRequest } from "../middlewares/authorize.middleware.js";
import { deleteImageFromCloudinary } from "../utils/cloudinary";
import { StoreItem } from "../models/storeItem.model";
import Level from "../models/level.model";

export const createLevel = async (req: AuthRequest, res: Response) => {
    let imageUrl = "";
    try {
        const { text, level, image, name, price, priceOptions, animationUrl, badgeText, validity, desc,
          audience = 'general', isStaffOnly = false } = req.body;
        const frameName = (name || text || '').trim();
        const frameLevel = Number(level) || 1;
        const staffOnly = audience === 'employee' || isStaffOnly === true;

        if (!frameName || !image) {
            return res.status(400).json({ error: "Frame name and image are required" });
        }

        imageUrl = image;

        // 1. Create or update in Level collection
        let levelData = await Level.findOne({ level: frameLevel });
        if (levelData) {
            levelData.name = frameName;
            levelData.text = frameName;
            levelData.image = imageUrl;
            levelData.audience = staffOnly ? 'employee' : audience;
            levelData.isStaffOnly = staffOnly;
            await levelData.save();
        } else {
            levelData = await levelService.createLevel({
              name: frameName, text: frameName, level: frameLevel, image: imageUrl,
              audience: staffOnly ? 'employee' : audience, isStaffOnly: staffOnly,
            } as any);
        }

        // StoreItem owns the app's catalog price. Level sync updates frame
        // metadata without replacing a configured store price with a default.
        const updateDoc: any = {
          name: frameName,
          category: 'Frames',
          validity: validity || '30 Days',
          badgeText: badgeText || 'HOT',
          previewColor: '#F43F5E',
          imageUrl: imageUrl,
          audience: staffOnly ? 'employee' : audience,
          isStaffOnly: staffOnly,
          desc: desc || `Avatar profile frame: ${frameName}`,
          isActive: true,
          sortOrder: frameLevel,
        };

        if (animationUrl !== undefined && animationUrl !== null) {
          updateDoc.animationUrl = animationUrl;
          updateDoc.metadata = {
            frameLevel,
            animated: Boolean(animationUrl),
          };
        }

        const storeItemFilter = {
          category: { $in: ['Frames', 'Frame'] },
          $or: [{ name: frameName }, { imageUrl: imageUrl }]
        };
        const existingStoreItem = await StoreItem.findOne(storeItemFilter).select('_id');
        const hasExplicitPrice = price !== undefined && price !== null && price !== '';
        const hasExplicitPriceOptions = Array.isArray(priceOptions) && priceOptions.length > 0;

        if (hasExplicitPrice || hasExplicitPriceOptions) {
          const parsedPrice = hasExplicitPrice ? Math.max(0, Number(price) || 0) : 0;
          const ratios: Record<number, number> = { 3: 0.15, 7: 0.3, 15: 0.55, 30: 1 };
          const normalizedPrices = [3, 7, 15, 30].map((days) => {
            const supplied = priceOptions?.find((option: any) => Number(option?.days) === days);
            const diamonds = supplied
              ? Math.max(0, Number(supplied.diamonds) || 0)
              : Math.round(parsedPrice * ratios[days]);
            return { days, diamonds };
          });
          updateDoc.priceOptions = normalizedPrices;
          updateDoc.price = normalizedPrices.find((option) => option.days === 30)?.diamonds ?? parsedPrice;
        }

        if (existingStoreItem || hasExplicitPrice || hasExplicitPriceOptions) {
          await StoreItem.findOneAndUpdate(
            storeItemFilter,
            updateDoc,
            { upsert: !existingStoreItem, new: true }
          );
        }

        res.status(201).json({ success: true, message: staffOnly ? 'Staff frame uploaded and hidden from the public store.' : 'Frame uploaded and synced to Store!', data: levelData });
    } catch (err: any) {
        if (imageUrl && imageUrl.includes("cloudinary")) {
            await deleteImageFromCloudinary(imageUrl);
        }
        res.status(400).json({ error: err.message });
    }
};

export const getLevels = async (req: AuthRequest, res: Response) => {
    try {
        const levels = await levelService.getLevels();
        res.json(levels);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
};

export const deleteLevel = async (req: Request, res: Response) => {
    try {
        const id = req.params.id;
        const level = await Level.findById(id);
        const frameName = level?.name || level?.text;

        const deleted = await levelService.deleteLevel(id);

        if (frameName || level?.image) {
          await StoreItem.deleteMany({
            category: { $in: ['Frames', 'Frame'] },
            $or: [
              ...(frameName ? [{ name: frameName }] : []),
              ...(level?.image ? [{ imageUrl: level.image }] : [])
            ]
          });
        }

        res.json({ success: true, message: 'Frame deleted from levels and store', data: deleted });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
};



