/**
 * Teste manual do token da zona privada do Bunny (Token Authentication).
 *
 * Lê BUNNY_PRIVATE_CDN_URL e BUNNY_PRIVATE_TOKEN_KEY do ambiente (ou do .env), gera com o MESMO
 * getPrivateSignedUrl do backend um URL de 60 s para um ficheiro de teste e imprime SÓ o URL
 * (nunca a chave). Não faz pedidos de rede: abre-se o URL à parte (curl).
 *
 * Uso (na VPS, na raiz do repositório):
 *   1. Carrega um ficheiro de teste para a Storage Zone privada, em kyc/_teste/teste.jpg
 *      (painel do Bunny, ou curl -X PUT com o AccessKey da zona).
 *   2. pnpm --filter @workspace/scripts exec tsx ./src/test-private-token.ts [kyc/_teste/teste.jpg]
 *   3. curl -s -o /dev/null -w "%{http_code}\n" "<URL impresso>"                  → esperado 200
 *      curl -s -o /dev/null -w "%{http_code}\n" "<URL sem ?token=…&expires=…>"    → esperado 403
 *      curl -s -o /dev/null -w "%{http_code}\n" "<URL com um carácter do token alterado>" → esperado 403
 *      (passados 60 s o URL original também dá 403)
 */

import "dotenv/config";
import path from "node:path";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

// Import dinâmico do backend (fora do rootDir deste pacote): usa exactamente o código de produção.
const storagePath = path.resolve(import.meta.dirname, "../../artifacts/api-server/src/lib/storage.ts");
const { getMissingPrivateStorageEnv, getPrivateSignedUrl } = (await import(pathToFileURL(storagePath).href)) as {
  getMissingPrivateStorageEnv: () => string[];
  getPrivateSignedUrl: (key: string, ttlSeconds?: number) => { url: string; expiresAt: Date };
};

const missing = getMissingPrivateStorageEnv();
if (missing.length > 0) {
  console.error(`Faltam variáveis: ${missing.join(", ")}`);
  process.exit(1);
}

const key = process.argv[2] ?? "kyc/_teste/teste.jpg";
if (!key.startsWith("kyc/")) {
  console.error("O ficheiro de teste tem de estar na zona privada, em kyc/…");
  process.exit(1);
}

console.log(getPrivateSignedUrl(key, 60).url);
