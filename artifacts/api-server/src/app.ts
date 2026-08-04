import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
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

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: "Demasiadas tentativas de renovação de sessão. Tenta novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter por userId para operações financeiras (gorjetas).
// Usa o userId extraído do Bearer token como chave — impede que um token
// comprometido seja usado para bombardear a DB com transações.
const gorjetaLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10,
  message: { error: "Demasiadas gorjetas num curto espaço de tempo. Tenta novamente dentro de 1 minuto." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Extrair userId do JWT sem verificar assinatura (só para chave do limiter).
    // A verificação real acontece em requireAuth — aqui basta isolar o utilizador.
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        const payload = JSON.parse(
          Buffer.from(auth.slice(7).split(".")[1]!, "base64url").toString()
        );
        if (payload?.userId) return `user:${payload.userId}`;
      } catch {
        // fallback para IP se o token for malformado
      }
    }
    return req.ip ?? "unknown";
  },
});

// Aplicar antes do router principal
app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/register", registerLimiter);
app.use("/api/auth/refresh", refreshLimiter);
app.use("/api/posts", gorjetaLimiter);

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
app.use(cookieParser());

// ─── Rotas ────────────────────────────────────────────────────────────────────
app.use("/api", router);

// ─── Error handler global ─────────────────────────────────────────────────────
// Deve ser o último middleware. Captura erros não tratados propagados via next(err)
// ou lançados em handlers async (Express 5 propaga automaticamente).
// Nunca expõe stack traces ao cliente — apenas loga internamente.
import type { ErrorRequestHandler } from "express";
const globalErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  (req as any).log?.error({ err }, "Erro não tratado");
  if (!res.headersSent) {
    res.status(500).json({ error: "Erro interno." });
  }
};
app.use(globalErrorHandler);

export default app;
