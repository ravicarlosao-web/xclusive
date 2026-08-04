import app from "./app";
import { logger } from "./lib/logger";

// NODE_ENV deve ser definido explicitamente. Sem ele, o CORS permissivo de dev
// fica desativado (comportamento seguro), mas a ausência pode indicar uma
// configuração incorreta do ambiente.
if (!process.env.NODE_ENV) {
  logger.warn(
    "NODE_ENV não está definido — a assumir modo de produção (CORS restrito). " +
    "Define NODE_ENV=development para ambiente de desenvolvimento local.",
  );
  process.env.NODE_ENV = "production";
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
