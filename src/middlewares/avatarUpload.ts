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
    let ext = path.extname(file.originalname || "").toLowerCase();
    if (!allowedExtensions.has(ext)) {
      ext = file.mimetype.includes("png") ? ".png" : file.mimetype.includes("webp") ? ".webp" : ".jpg";
    }
    const userId = req.user?.userId || "user";
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e4)}`;
    cb(null, `avatar-${userId}-${uniqueSuffix}${ext}`);
  },
});

const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ""]);
const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/pjpeg",
  "application/octet-stream",
]);
const disallowedExtensions = new Set([
  ".exe", ".sh", ".bat", ".cmd", ".js", ".ts", ".php", ".py", ".bin",
  ".jar", ".apk", ".vbs", ".msi", ".scr", ".com", ".pif", ".cgi", ".pl"
]);

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname || "").toLowerCase();

  if (ext && disallowedExtensions.has(ext)) {
    return cb(new Error("Executable or script files are strictly forbidden"));
  }

  const mime = (file.mimetype || "").toLowerCase();
  const isValidMime = allowedMimeTypes.has(mime) || mime.startsWith("image/");
  const isValidExt = !ext || allowedExtensions.has(ext);

  if (isValidMime && isValidExt) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid image file format (${mime || ext}). Allowed formats: JPG, JPEG, PNG, WEBP`));
  }
};

export const avatarUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB max file size
  },
});
