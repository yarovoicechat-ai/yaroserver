import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config({ quiet: true });

export const REQUIRED_DATABASE_NAME = "yaro_live";

let connectionPromise: Promise<typeof mongoose> | null = null;
let listenersRegistered = false;

export const sanitizeMongoError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/mongodb(?:\+srv)?:\/\/[^\s'"\`]+/gi, "[redacted MongoDB URI]")
    .replace(/\/\/[^\s/:@]+:[^\s/@]+@/g, "//<redacted>@");
};

export const getMongoUri = (): string => {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new Error("MONGODB_URI is required and must be set in the environment");
  }

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error("MONGODB_URI is not a valid MongoDB connection URI");
  }

  if (parsed.protocol !== "mongodb:" && parsed.protocol !== "mongodb+srv:") {
    throw new Error("MONGODB_URI must use the mongodb:// or mongodb+srv:// protocol");
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (databaseName !== REQUIRED_DATABASE_NAME) {
    throw new Error(`MONGODB_URI must target the ${REQUIRED_DATABASE_NAME} database`);
  }

  return uri;
};

const registerConnectionListeners = (): void => {
  if (listenersRegistered) return;
  listenersRegistered = true;

  mongoose.connection.on("error", (error) => {
    console.error(`MongoDB connection error: ${sanitizeMongoError(error)}`);
  });
  mongoose.connection.on("disconnected", () => {
    console.warn("MongoDB disconnected");
  });
  mongoose.connection.on("reconnected", () => {
    console.info("MongoDB reconnected");
  });
};

export const connectDB = async (): Promise<typeof mongoose> => {
  if (mongoose.connection.readyState === 1) {
    const currentDatabase = mongoose.connection.db?.databaseName;
    if (currentDatabase !== REQUIRED_DATABASE_NAME) {
      throw new Error(`Existing Mongoose connection targets unexpected database: ${currentDatabase || "unknown"}`);
    }
    return mongoose;
  }

  if (connectionPromise) return connectionPromise;

  getMongoUri();
  registerConnectionListeners();

  connectionPromise = mongoose.connect(process.env.MONGODB_URI as string, {
    maxPoolSize: 50,
    minPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  }).then(async (client) => {
    const databaseName = client.connection.db?.databaseName;
    if (databaseName !== REQUIRED_DATABASE_NAME) {
      await client.disconnect();
      throw new Error(`Connected to unexpected MongoDB database: ${databaseName || "unknown"}`);
    }
    console.info(`MongoDB connected (database: ${databaseName})`);
    return client;
  }).catch((error) => {
    throw new Error(`MongoDB connection failed: ${sanitizeMongoError(error)}`);
  }).finally(() => {
    connectionPromise = null;
  });

  return connectionPromise;
};

export const disconnectDB = async (): Promise<void> => {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
  console.info("MongoDB connection closed");
};
