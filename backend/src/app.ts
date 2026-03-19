import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { apiRouter } from "./api/rest/router.js";
import { config } from "./config/index.js";
import { createChildLogger } from "./logger.js";
import { httpRequestsTotal, httpRequestDuration, registry } from "./metrics/index.js";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "./api/openapi.js";

const log = createChildLogger("http");

export function createApp() {
  const app = express();

  // 2.2 — Security headers
  app.use(helmet());

  // 2.3 — Restrictive CORS
  const allowedOrigins = config.corsOrigins.split(",").map((o) => o.trim());
  app.use(
    cors({
      origin: config.nodeEnv === "development" ? true : allowedOrigins,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    }),
  );

  app.use(express.json({ limit: "10mb" }));

  // 2.1 — Rate limiting: general
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 200,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many requests, please try again later" },
    }),
  );

  // 5.1 — Prometheus metrics middleware
  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.setHeader("X-Request-Id", requestId);
    const start = performance.now();

    res.on("finish", () => {
      const duration = Math.round(performance.now() - start);
      const route = req.route?.path ?? req.path;

      log.info(
        { requestId, method: req.method, url: req.originalUrl, status: res.statusCode, durationMs: duration },
        `${req.method} ${req.originalUrl} ${res.statusCode}`,
      );

      // Skip metrics endpoint itself to avoid recursion
      if (req.path !== "/metrics") {
        httpRequestsTotal.inc({ method: req.method, route, status: String(res.statusCode) });
        httpRequestDuration.observe({ method: req.method, route, status: String(res.statusCode) }, duration);
      }
    });

    next();
  });

  // 5.1 — Prometheus metrics endpoint
  app.get("/metrics", async (_req, res) => {
    res.set("Content-Type", registry.contentType);
    res.end(await registry.metrics());
  });

  // 5.2 — OpenAPI documentation
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
  app.get("/openapi.json", (_req, res) => res.json(openApiSpec));

  app.use("/api/v1", apiRouter);

  // 2.6 — Central error handler (must be after routes)
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    log.error({ err: err.message, stack: err.stack }, "Unhandled error");
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
