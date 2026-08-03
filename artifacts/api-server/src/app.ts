import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// ─── Segurança: headers HTTP ──────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // necessário para media URLs
    contentSecurityPolicy: false, // gerido pelo frontend (Vite)
  }),
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      // Pedidos sem origin (curl, apps mobile, SSR) são sempre permitidos
      if (!origin) return callback(null, true);
      // Em desenvolvimento: permitir localhost e domínios Replit
      if (process.env.NODE_ENV !== "production") {
        if (
          origin.includes("localhost") ||
          origin.includes("127.0.0.1") ||
          origin.includes(".replit.dev") ||
          origin.includes(".repl.co") ||
          origin.includes(".kirk.replit.dev")
        ) {
          return callback(null, true);
        }
      }
      // Em produção: lista branca explícita via ALLOWED_ORIGINS
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origem não permitida — ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// ─── Rate limiting ────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  message: { error: "Demasiadas tentativas de login. Tenta novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  message: { error: "Demasiados registos a partir deste IP. Tenta novamente em 1 hora." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Aplicar antes do router principal
app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/register", registerLimiter);

// ─── Logging ──────────────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ─── Body parsers (com limite explícito) ──────────────────────────────────────
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));

// ─── Rotas ────────────────────────────────────────────────────────────────────
app.use("/api", router);

export default app;
