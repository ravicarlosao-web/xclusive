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

// Aumentar os limites de tempo do servidor Node.js para suportar uploads de ficheiros até 500MB (40 minutos / 2400s):
server.requestTimeout = 40 * 60 * 1000; // 2.400.000 ms (alinhado com o Nginx a 2400s)
server.timeout = 40 * 60 * 1000;        // 40 minutos de timeout de inactividade do socket
server.headersTimeout = 65 * 1000;      // 65 segundos para recepção dos headers HTTP
server.keepAliveTimeout = 60 * 1000;    // 60 segundos de keep-alive
