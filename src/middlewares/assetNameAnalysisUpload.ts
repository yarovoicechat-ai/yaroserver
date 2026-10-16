import multer from "multer";

const supportedImageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export const assetNameAnalysisUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (supportedImageTypes.has(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(new Error("AI naming accepts PNG, JPEG, WebP, or non-animated GIF preview images"));
  },
});
