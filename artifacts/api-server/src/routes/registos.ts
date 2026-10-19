import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { lerRegistosAbertos } from "../lib/registos";

/**
 * Estado público dos registos (sem sessão): só devolve { abertos }. Nada mais é exposto.
 * O globalAuthLimiter não cobre pedidos sem Bearer, por isso tem o seu próprio limite por IP.
 */
const router = Router();

const limite = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "Demasiados pedidos. Tenta novamente dentro de 1 minuto." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
});

router.get("/registos/estado", limite, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  try {
    res.json({ abertos: await lerRegistosAbertos() });
  } catch (err) {
    (req as any).log?.error({ err }, "Registos: falha ao ler o estado");
    res.status(503).json({ error: "Serviço temporariamente indisponível." });
  }
});

export default router;
