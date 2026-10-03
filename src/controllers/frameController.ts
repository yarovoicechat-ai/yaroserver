import { Request, Response } from "express";
import * as levelService from "../services/frame.service";
import { AuthRequest } from "../middlewares/authorize.middleware.js";
import { deleteImageFromCloudinary } from "../utils/cloudinary";
import { StoreItem } from "../models/storeItem.model";
import Level from "../models/level.model";

export const syncLevelsToStoreItems = async () => {
  try {
    const levels = await Level.find({ image: { $exists: true, $ne: "" } }).lean();
    for (const lvl of levels) {
      const frameName = lvl.name || lvl.text || `Frame Level ${lvl.level}`;
      const exists = await StoreItem.findOne({
        category: { $in: ['Frames', 'Frame'] },
        $or: [{ name: frameName }, { imageUrl: lvl.image }]
      });

      if (!exists) {
        const price = 3500;
        await StoreItem.create({
          name: frameName,
          category: 'Frames',
          price,
          priceOptions: [
            { days: 3, diamonds: 525 },
            { days: 7, diamonds: 1050 },
            { days: 15, diamonds: 1925 },
            { days: 30, diamonds: price },
          ],
          validity: '30 Days',
          badgeText: 'HOT',
          previewColor: '#F43F5E',
          imageUrl: lvl.image,
          desc: `Avatar profile frame: ${frameName}`,
          isActive: true,
          sortOrder: lvl.level || 1,
          metadata: { frameLevel: lvl.level || 1 },
        });
        console.log(`[FrameSync] Automatically synced frame "${frameName}" to StoreItem!`);
      }
    }
  } catch (err: any) {
    console.warn('[FrameSync] Sync warning:', err.message);
  }
};

export const createLevel = async (req: AuthRequest, res: Response) => {
    let imageUrl = "";
    try {
        const { text, level, image, name, price, priceOptions, animationUrl, badgeText, validity, desc } = req.body;
        const frameName = (name || text || '').trim();
        const frameLevel = Number(level) || 1;

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
            await levelData.save();
        } else {
            levelData = await levelService.createLevel({ name: frameName, text: frameName, level: frameLevel, image: imageUrl });
        }

        // 2. Auto-create or update in StoreItem collection so it immediately appears in the Store!
        const parsedPrice = Number(price) || 3500;
        const normalizedPrices = Array.isArray(priceOptions) && priceOptions.length === 4
          ? priceOptions
          : [
              { days: 3, diamonds: Math.round(parsedPrice * 0.15) },
              { days: 7, diamonds: Math.round(parsedPrice * 0.3) },
              { days: 15, diamonds: Math.round(parsedPrice * 0.55) },
              { days: 30, diamonds: parsedPrice },
            ];

        const updateDoc: any = {
          name: frameName,
          category: 'Frames',
          price: parsedPrice,
          priceOptions: normalizedPrices,
          validity: validity || '30 Days',
          badgeText: badgeText || 'HOT',
          previewColor: '#F43F5E',
          imageUrl: imageUrl,
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

        await StoreItem.findOneAndUpdate(
          {
            category: { $in: ['Frames', 'Frame'] },
            $or: [{ name: frameName }, { imageUrl: imageUrl }]
          },
          updateDoc,
          { upsert: true, new: true }
        );

        res.status(201).json({ success: true, message: 'Frame uploaded and synced to Store!', data: levelData });
    } catch (err: any) {
        if (imageUrl && imageUrl.includes("cloudinary")) {
            await deleteImageFromCloudinary(imageUrl);
        }
        res.status(400).json({ error: err.message });
    }
};

export const getLevels = async (req: AuthRequest, res: Response) => {
    try {
        await syncLevelsToStoreItems();
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



