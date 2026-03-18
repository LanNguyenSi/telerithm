import cors from "cors";
import express from "express";
import { apiRouter } from "./api/rest/router.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/v1", apiRouter);
  return app;
}

