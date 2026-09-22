import express, { Application } from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";

import errorHandler from "./middlewares/errorHnadler.middleware";
import { disconnectDB, sanitizeMongoError } from "./utils/db";
import { initializeDatabase } from "./utils/initializeDatabase";
import { config } from "./configs/envConfig";
import { checkPortAvailable } from "./utils/getAvailablePort";
import { AuthRoutes, avatarRoute, callRoutes, chatRoutes, coinsPriceRoutes, frameRoute, hostRoutes, UserRoutes, adminRoutes, paymentRoutes, kycRoutes, withdrawalRoutes, giftRoutes, helpRoutes, UploadRoutes, notificationRoutes, upiRoutes, publicRoutes, emsRoutes, recruitmentRoutes, sellerRoutes, voiceClubRoutes } from "./routes";
import { approveStockRequest, rejectStockRequest, getAllStockRequestsAdmin, updateSellerPricingConfig, verifySellerForAdmin, adminCreditSellerDiamonds } from "./controllers/sellerAdminController";
import chatSocket from "./sockets";
import path from "path";
// Initialize Firebase Admin before routes are loaded
import "./utils/pushNotification";
import { verifyToken } from "./middlewares/authorize.middleware";
import { getSystemMessages } from "./controllers/notificationController";
import verificationRoutes from "./routes/verificationRoutes";
import adminVerificationRoutes from "./routes/adminVerificationRoutes";

const app: Application = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

// 4. CORS Configuration - Restrict origins
const allowedOrigins = [
  process.env.CORS_ORIGIN || 'https://yaroapp.in',
  'http://localhost:3100',
  'http://localhost:3101',
  'http://localhost:3102',
  'http://localhost:3105',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5050',

  'https://yaroapp.in',
  'https://www.yaroapp.in',
  'https://api.yaroapp.in',

  'https://admin.yaroapp.in',
  'http://admin.yaroapp.in',

  'https://agency.yaroapp.in',
  'https://operator.yaroapp.in',
  'https://host.yaroapp.in',
  'https://adminjoin.yaroapp.in',
  'https://support.yaroapp.in',
  'https://superadmin.yaroapp.in',

  'https://management.yaroapp.in',
  'http://management.yaroapp.in',

  'https://danilo-syngamic-unterrifically.ngrok-free.dev',
].filter(Boolean);

const isLocalhostOrigin = (origin: string) => {
  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1'].includes(url.hostname) || url.hostname.endsWith('.yaroapp.in') || url.hostname === 'yaroapp.in';
  } catch {
    return false;
  }
};

app.use(cors({
  origin: (origin, callback) => {
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-simulation-user-id'],
}));

app.use((req, res, next) => {
  console.log(`📡 Incoming Request: ${req.method} ${req.url}`);
  next();
});

// Security Middleware
// 1. Helmet - Secure HTTP headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for API
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// 3. Rate Limiting - Prevent DDoS
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 100, // Limit each IP to 100 requests per windowMs
//   message: 'Too many requests from this IP, please try again later.',
//   standardHeaders: true,
//   legacyHeaders: false,
// });
// app.use('/api/', limiter);

app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use("/policies", express.static(path.join(__dirname, "../policies")));

// Body parsing with size limits
app.use(express.json({ limit: '50mb' })); // Increased for document base64 payloads
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use("/api/user", UserRoutes);
app.use("/api/v1/user", UserRoutes);
app.use("/api/auth", AuthRoutes);
app.use("/api/v1/auth", AuthRoutes);
app.use("/api/host", hostRoutes);
app.use("/api/v1/host", hostRoutes);
app.use("/api/coinsPrice", coinsPriceRoutes);
app.use("/api/call", callRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/frames", frameRoute);
app.use("/api/avatar", avatarRoute);
app.use("/api/admin", adminRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/ems", emsRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/kyc", kycRoutes);
app.use("/api/withdrawal", withdrawalRoutes);
app.use("/api/gift", giftRoutes);
app.use("/api/help", helpRoutes);
app.use("/api/upload", UploadRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/voiceclub", voiceClubRoutes);
app.use("/api/v1/voiceclub", voiceClubRoutes);
app.use("/api/seller", sellerRoutes);
app.use("/api/v1/seller", sellerRoutes);
app.use("/api/verifications", verificationRoutes);
app.use("/api/v1/verifications", verificationRoutes);
app.use("/api/v1/admin/verifications", adminVerificationRoutes);
app.get("/api/admin/sellers/stock-requests", verifyToken, getAllStockRequestsAdmin);
app.post("/api/admin/sellers/stock-requests/:id/approve", verifyToken, approveStockRequest);
app.post("/api/admin/sellers/stock-requests/:id/reject", verifyToken, rejectStockRequest);
app.put("/api/admin/sellers/config", verifyToken, updateSellerPricingConfig);
app.get("/api/admin/sellers/verify/:sellerId", verifyToken, verifySellerForAdmin);
app.post("/api/admin/sellers/add-diamonds", verifyToken, adminCreditSellerDiamonds);
app.post("/api/admin/sellers/recharge", verifyToken, adminCreditSellerDiamonds);
import avatarRequestRoutes from "./routes/avatarRequestRoutes";
import defaultBioRoutes from "./routes/defaultBioRoutes";
app.use("/api/avatar-request", avatarRequestRoutes);
app.use("/api/avatar-requests", avatarRequestRoutes);
app.use("/api/v1/avatar-requests", avatarRequestRoutes);
app.use("/api/default-bios", defaultBioRoutes);
app.use("/api/v1/default-bios", defaultBioRoutes);
app.use("/api/upi", upiRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/teamleader", publicRoutes);
import referralRoutes from "./routes/referral.routes";
app.use("/api", referralRoutes);
app.use("/", referralRoutes);
import moderationRiskRoutes from "./routes/moderationRiskRoutes";
app.use("/api", moderationRiskRoutes);
import appReleaseRoutes from "./routes/appReleaseRoutes";
app.use("/api/v1/app-releases", appReleaseRoutes);
app.use("/api/app-releases", appReleaseRoutes);
import appScreenRoutes from "./routes/appScreenRoutes";
app.use("/api/v1/app-screens", appScreenRoutes);
app.use("/api/app-screens", appScreenRoutes);
import { globalSearch } from "./controllers/searchController";
import { getSystemHealth } from "./controllers/monitoringController";
import { getActivityFeed } from "./controllers/activityFeedController";
import { generateCustomReport } from "./controllers/reportBuilderController";
import { getAllPlugins, togglePluginStatus } from "./controllers/pluginController";
import { getTasks, createTask, updateTaskStatus } from "./controllers/taskController";
import { generateAIPlatformInsights } from "./services/aiInsightsService";

// Enterprise V6.0 High Availability & Prometheus Health Checks
app.get('/healthz', (_req, res) => res.status(200).json({ status: 'OK', timestamp: new Date() }));
app.get('/livez', (_req, res) => res.status(200).json({ status: 'ALIVE', uptime: process.uptime() }));
app.get('/readyz', (_req, res) => res.status(200).json({ status: 'READY', db: 'CONNECTED' }));
app.get('/metrics', (_req, res) => res.type('text/plain').send(`# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.\n# TYPE process_cpu_seconds_total counter\nprocess_cpu_seconds_total ${process.cpuUsage().user / 1000000}\n# HELP process_resident_memory_bytes Resident memory size in bytes.\n# TYPE process_resident_memory_bytes gauge\nprocess_resident_memory_bytes ${process.memoryUsage().rss}\n`));

app.use("/api/recruitment", recruitmentRoutes);
app.use("/api/v1/recruitment", recruitmentRoutes);
import chatViolationRoutes from "./routes/chatViolationRoutes";
app.use("/api/moderation", chatViolationRoutes);
app.use("/api/v1/moderation", chatViolationRoutes);
app.get("/api/v1/search", globalSearch);
app.get("/api/v1/monitoring/health", getSystemHealth);
app.get("/api/v1/activity-feed", getActivityFeed);
app.get("/api/v1/reports", generateCustomReport);
app.get("/api/v1/plugins", getAllPlugins);
app.patch("/api/v1/plugins/:pluginId", togglePluginStatus);
app.get("/api/v1/tasks", getTasks);
app.post("/api/v1/tasks", createTask);
app.patch("/api/v1/tasks/:id/status", updateTaskStatus);
import { getBIDrilldownOverview } from "./controllers/biController";
import { analyzeProcessMiningBottlenecks } from "./services/processMiningService";

app.get("/api/v1/bi/overview", getBIDrilldownOverview);
app.get("/api/v1/process-mining/bottlenecks", async (_req, res) => {
    const data = await analyzeProcessMiningBottlenecks();
    res.status(200).json(data);
});
app.get("/api/v1/analytics/ai-insights", async (_req, res) => {
    const data = await generateAIPlatformInsights();
    res.status(200).json(data);
});
app.get("/api/system-messages", verifyToken, getSystemMessages);

// Root Route
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    service: "Yaro API",
    message: "API is running successfully",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });
});

// Health Route
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// API Info
app.get("/api", (req, res) => {
  res.status(200).json({
    success: true,
    service: "Yaro API",
    version: "1.0.0"
  });
});

// Error handler
app.use(errorHandler);

// Create HTTP server
const httpServer = http.createServer(app);

// Attach socket.io with secure CORS
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST']
  },
  pingTimeout: 30000,
  pingInterval: 25000,
});

// Init chat socket
chatSocket(io);

const startServer = async (): Promise<void> => {
  const port = Number(config.PORT || 3101);
  const isAvailable = await checkPortAvailable(port);
  if (!isAvailable) {
    throw new Error(`Port ${port} is already in use`);
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    httpServer.once("error", onError);
    httpServer.listen(port, "0.0.0.0", () => {
      httpServer.off("error", onError);
      console.log(`Server running at http://localhost:${port}`);
      resolve();
    });
  });

  try {
    await initializeDatabase();
    startCallCleanupJob();
    startChatWorker();
    startWeeklyHostLevelJob();
    startStaleHostCleanupJob();
  } catch (error) {
    console.warn(`[WARN] Initial database connection failed: ${sanitizeMongoError(error)}. Retrying in background...`);
    const retryInterval = setInterval(async () => {
      try {
        await initializeDatabase();
        clearInterval(retryInterval);
        startCallCleanupJob();
        startChatWorker();
        startWeeklyHostLevelJob();
        startStaleHostCleanupJob();
        console.info("[INFO] Database connected on retry!");
      } catch (_) {}
    }, 10000);
  }
};

let isShuttingDown = false;

const shutdown = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.info(`${signal} received; shutting down`);

  try {
    await new Promise<void>((resolve, reject) => {
      if (!httpServer.listening) return resolve();
      httpServer.close((error) => error ? reject(error) : resolve());
    });
    await disconnectDB();
    process.exit(0);
  } catch (error) {
    console.error(`Graceful shutdown failed: ${sanitizeMongoError(error)}`);
    process.exit(1);
  }
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

import { startCallCleanupJob, startChatWorker, startWeeklyHostLevelJob, startStaleHostCleanupJob } from "./services/cron.service";

startServer().catch(async (error) => {
  console.error(`Error starting the server: ${sanitizeMongoError(error)}`);
  await disconnectDB().catch(() => undefined);
  process.exit(1);
});
