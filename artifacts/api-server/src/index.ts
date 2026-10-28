import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });
dotenv.config();

import app from "./app";
import { logger } from "./lib/logger";
import { initSocket } from "./lib/socket";
import { startSubscriptionExpiryJob } from "./lib/subscriptionExpiry";
import { startReportEscalationJob } from "./lib/reportEscalation";

// Falhas não tratadas: regista (o hook do logger redige erros de BD: sem query nem parâmetros) e TERMINA com
// código 1 após um pequeno atraso para o log sair; o PM2 reinicia. Nunca engole o erro e continua.
let aTerminar = false;
function terminarPorFalha(): void {
  if (aTerminar) return;
  aTerminar = true;
  setTimeout(() => process.exit(1), 500);
}
process.on("unhandledRejection", (reason) => {
  // Se o motivo não for um Error, só o tipo é registado (o valor pode conter dados).
  const err = reason instanceof Error ? reason : new Error(`Promessa rejeitada sem tratamento (valor do tipo ${typeof reason})`);
  logger.fatal({ err }, "Promessa rejeitada sem tratamento: a terminar");
  terminarPorFalha();
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Exceção não tratada: a terminar");
  terminarPorFalha();
});

if (!process.env.NODE_ENV) {
  // Falha fechada: sem NODE_ENV o servidor corre como produção (nunca como desenvolvimento).
  process.env.NODE_ENV = "production";
  logger.warn("NODE_ENV não definido — a assumir 'production'. Define NODE_ENV=development só em desenvolvimento local.");
}

const rawPort = process.env["PORT"] || "8080";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, () => {
  logger.info({ port }, "Server listening");
});

// Inicializar Socket.io (partilha a mesma porta do HTTP)
initSocket(server);

// Intervalos efetivos dos jobs (só valores numéricos, em ms; mesma regra de validação dos jobs).
logger.info(
  {
    subscriptionExpiryIntervalMs: Number(process.env.SUBSCRIPTION_EXPIRY_INTERVAL_MS) || 5 * 60 * 1000,
    reportEscalationIntervalMs: Number(process.env.REPORT_ESCALATION_INTERVAL_MS) || 5 * 60 * 1000,
  },
  "Intervalos dos jobs periódicos (ms)",
);

// Expira subscrições vencidas e notifica (nunca cobra; renovação é manual)
startSubscriptionExpiryJob();

// Avisa os admins de denúncias urgentes por tratar (1 h e 24 h); idempotente e com lock
startReportEscalationJob();

// Aumentar os limites de tempo do servidor Node.js para suportar uploads de ficheiros até 500MB (40 minutos / 2400s):
server.requestTimeout = 40 * 60 * 1000; // 2.400.000 ms (alinhado com o Nginx a 2400s)
server.timeout = 40 * 60 * 1000;        // 40 minutos de timeout de inactividade do socket
server.headersTimeout = 65 * 1000;      // 65 segundos para recepção dos headers HTTP
server.keepAliveTimeout = 60 * 1000;    // 60 segundos de keep-alive
