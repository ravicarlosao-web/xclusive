import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });
dotenv.config();

import app from "./app";
import { logger } from "./lib/logger";

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "development";
  logger.info("NODE_ENV não definido — definido automaticamente como 'development'.");
}

const rawPort = process.env["PORT"] || "8080";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, () => {
  logger.info({ port }, "Server listening");
});

// Aumentar os limites de tempo do servidor Node.js para suportar uploads de ficheiros até 500MB (20 minutos):
server.requestTimeout = 20 * 60 * 1000; // 1.200.000 ms (era 300.000 ms por defeito no Node.js 18+)
server.timeout = 20 * 60 * 1000;        // 20 minutos de timeout de inactividade do socket
server.headersTimeout = 65 * 1000;      // 65 segundos para recepção dos headers HTTP
server.keepAliveTimeout = 60 * 1000;    // 60 segundos de keep-alive
