import dotenv from "dotenv";
dotenv.config();

import express from "express";
import bodyParser from "body-parser";
import routes from "./routes";
import v1Routes from "./v1/routes";
import mobileBridge from "./mobile_bridge";
import stats from "./stats";
import workerRoutes from "./worker";
import { initRedis, isRedisConnected } from "../shared/redis";
import { initDatabase, isDatabaseConnected } from "../shared/db";
import { logger } from "../shared/logger";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

const app = express();
app.use(bodyParser.json());

app.use("/api", routes);
app.use("/api/v1", v1Routes);
app.use("/api", mobileBridge); // Phantom Bridge (Mobile/Plugin API)
app.use("/api", stats); // Stats & Leaderboards API
app.use("/api/worker", workerRoutes); // Worker registration & profiles

// Error handling (must be last)
app.use(notFoundHandler); // 404 handler
app.use(errorHandler); // General error handler

const PORT = process.env.PORT || 4000;

async function startServer() {
  try {
    // Initialize database (required - will exit if fails)
    await initDatabase();

    // Initialize Redis (optional in dev, required in prod)
    await initRedis();

    // Start server
    app.listen(PORT, () => {
      logger.info(`[API] Server listening on http://localhost:${PORT}`);
      logger.info(`[API] Environment: ${process.env.NODE_ENV || "development"}`);
      logger.info(`[API] Database: ${isDatabaseConnected() ? "connected" : "disconnected"}`);
      logger.info(`[API] Redis: ${isRedisConnected() ? "connected" : "disconnected"}`);
    });
  } catch (error) {
    logger.error("[API] Failed to start server", { error });
    process.exit(1);
  }
}

// Start server if this file is run directly
if (require.main === module) {
  startServer();
}

export { startServer };

