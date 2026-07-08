import express from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";

const app = express();

app.use(pinoHttp({ logger }));

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim())
  : [process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : ""];

app.use(
  cors({
    credentials: true,
    origin: (origin, cb) => {
      // Allow requests with no origin (server-to-server, curl)
      if (!origin) return cb(null, true);
      if (allowedOrigins.some((o) => origin === o || origin.endsWith(`.${o.replace(/^https?:\/\//, "")}`))) {
        return cb(null, true);
      }
      // In development, allow any replit domain
      if (process.env.NODE_ENV === "development" && origin.includes("replit")) {
        return cb(null, true);
      }
      cb(new Error("CORS: origin not allowed"));
    },
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

export default app;
