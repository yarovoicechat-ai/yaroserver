import express from "express";
import { getUploadSignature, uploadDirectFile, uploadRoomCover } from "../controllers/uploadController";
import { verifyToken } from "../middlewares/authorize.middleware";
import { giftFileUpload } from "../middlewares/giftUpload";
import { roomCoverUpload } from "../middlewares/roomCoverUpload";
import { assetNameAnalysisUpload } from "../middlewares/assetNameAnalysisUpload";
import { analyzeAssetName } from "../controllers/uploadController";
import { requireRoles } from "../middlewares/authorize.middleware";

const router = express.Router();

const handleMulterUpload = (req: any, res: any, next: any) => {
  giftFileUpload.fields([
    { name: "file", maxCount: 1 },
    { name: "image", maxCount: 1 },
    { name: "asset", maxCount: 1 },
    { name: "icon", maxCount: 1 },
    { name: "svga", maxCount: 1 },
  ])(req, res, (err: any) => {
    if (err) return next(err);
    if (!req.file && req.files) {
      const files = req.files as Record<string, Express.Multer.File[]>;
      req.file = files.file?.[0] || files.image?.[0] || files.asset?.[0] || files.icon?.[0] || files.svga?.[0];
    }
    next();
  });
};

// Get signature for client-side Cloudinary upload
router.get("/signature", verifyToken, getUploadSignature);

// Room cover images are stored on the app server so this feature remains available
// when the Cloudinary account is disabled or misconfigured.
router.post("/room-cover", verifyToken, roomCoverUpload.single("file"), uploadRoomCover);

// Image analysis uses the server-side provider key and is available to admins only.
router.post("/analyze-name", verifyToken, requireRoles("owner", "superAdmin", "admin", "operator"), assetNameAnalysisUpload.single("file"), analyzeAssetName);

// Direct file upload for gift icons, animations (.svga, .gif, .webp, .png)
router.post("/file", verifyToken, handleMulterUpload, uploadDirectFile);
router.post("/", verifyToken, handleMulterUpload, uploadDirectFile);

export default router;
