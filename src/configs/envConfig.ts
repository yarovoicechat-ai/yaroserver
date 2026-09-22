import dotenv from "dotenv";
import path from "path";

// Load environment variables reliably regardless of process working directory
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// OAuth client IDs are public identifiers. Keep the Web client bundled with the
// mobile app in the allowlist so a stale process-manager environment cannot make
// a valid app token fail with "Wrong recipient" after a deployment.
export const YARO_GOOGLE_WEB_CLIENT_ID =
    "775252509237-aeqs5cd5viou7iv4r5chq8k15ccaq7ir.apps.googleusercontent.com";

export const buildGoogleClientIdAllowlist = (...values: Array<string | undefined>): string[] =>
    Array.from(new Set(
        values
            .flatMap((value) => String(value || "").split(","))
            .map((value) => value.trim())
            .filter(Boolean)
    ));

const googleClientIds = buildGoogleClientIdAllowlist(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_IDS,
    YARO_GOOGLE_WEB_CLIENT_ID
);

export const config = {
    PORT: process.env.PORT || 3101,
    MONGODB_URI: process.env.MONGODB_URI,
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || '2a869de490ac2e6f065b63be7c76ffd658af4fbb4feaf3c1ced1cd3959c9cfe2',
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || '812ade37d6ecfebbde7de546b9603c45a9ebb2ef174554f72a7e6d6c3d079f6a',
    ENCRYPTION_SECRET_KEY: process.env.ENCRYPTION_SECRET_KEY,
    SUPER_ADMIN_EMAIL: process.env.SUPER_ADMIN_EMAIL,
    EMAIL_USER: process.env.EMAIL_USER,
    EMAIL_PASS: process.env.EMAIL_PASS,
    SUPER_ADMIN_PASSWORD: process.env.SUPER_ADMIN_PASSWORD,
    SUPER_ADMIN_PHONE: process.env.SUPER_ADMIN_PHONE,
    SUPER_ADMIN_ROLE: process.env.SUPER_ADMIN_ROLE,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    AGORA_APP_ID: process.env.AGORA_APP_ID,
    AGORA_APP_CERTIFICATE: process.env.APP_CERTIFICATE,
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
    ORIGIN: process.env.ORIGIN,
    ORIGIN1: process.env.ORIGIN1,
    WEB_HOOK_PORT: process.env.WEB_HOOK_PORT || 4000,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || YARO_GOOGLE_WEB_CLIENT_ID,
    GOOGLE_CLIENT_IDS: googleClientIds,
    REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
    REDIS_PREFIX: process.env.REDIS_PREFIX || 'yaroapp:',
    VERIFICATION_ENCRYPTION_KEY: process.env.VERIFICATION_ENCRYPTION_KEY,
    VERIFICATION_PRIVATE_STORAGE_PATH: process.env.VERIFICATION_PRIVATE_STORAGE_PATH,
    VERIFICATION_MAX_FILE_SIZE_MB: process.env.VERIFICATION_MAX_FILE_SIZE_MB || '5',
};
