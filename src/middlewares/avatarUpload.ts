import multer from "multer";
import path from "path";
import fs from "fs";

const uploadDir = path.resolve(process.cwd(), "uploads/avatars");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req: any, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const userId = req.user?.userId || "user";
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e4)}`;
    cb(null, `avatar-${userId}-${uniqueSuffix}${ext}`);
  },
});

const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const disallowedExtensions = new Set([
  ".exe", ".sh", ".bat", ".cmd", ".js", ".ts", ".php", ".py", ".bin",
  ".jar", ".apk", ".vbs", ".msi", ".scr", ".com", ".pif", ".cgi", ".pl"
]);

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (disallowedExtensions.has(ext)) {
    return cb(new Error("Executable or script files are strictly forbidden"));
  }

  if (allowedExtensions.has(ext) && allowedMimeTypes.has(file.mimetype.toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid image file format. Allowed formats: JPG, JPEG, PNG, WEBP`));
  }
};

export const avatarUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB max file size
  },
});
