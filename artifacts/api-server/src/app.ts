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

    // HSTS — plataforma financeira requer 1 ano, subdomínios e preload
    //   • maxAge 31 536 000 s = 1 ano (mínimo exigido pelos browsers para preload)
    //   • includeSubDomains: protege api.xclusive.ao, cdn.xclusive.ao, etc.
    //   • preload: elegível para lista HSTS hardcoded do Chrome/Firefox/Safari
    //     (submeter em https://hstspreload.org após deploy em produção)
    strictTransportSecurity: {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: true,
    },

    // CSP — este servidor devolve apenas JSON; directivas defensivas para
    // o caso de alguma resposta ser interpretada como HTML por um cliente:
    //   • sem 'unsafe-inline' em styleSrc
    //   • objectSrc 'none'  — bloqueia plugins legados (Flash, Silverlight)
    //   • baseUri 'self'    — previne ataques de injecção via <base href>
    //   • frameAncestors 'none' — equivalente a X-Frame-Options: DENY
    //   • upgradeInsecureRequests — força HTTPS em recursos mistos
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
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
      // Em desenvolvimento: permitir localhost e domínios Replit.
      // Opt-in explícito em NODE_ENV=development — qualquer outro valor
      // (incluindo undefined) aplica a lista branca de produção.
      if (process.env.NODE_ENV === "development") {
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
