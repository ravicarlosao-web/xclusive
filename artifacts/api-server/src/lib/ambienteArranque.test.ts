import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { garantirAmbienteArranque } from "./ambienteArranque";

class Saiu extends Error {
  constructor(public codigo: number) { super(`exit ${codigo}`); }
}

function arrancar(env: Record<string, string | undefined>): { arrancou: boolean; codigo?: number; saida: string } {
  let saida = "";
  try {
    garantirAmbienteArranque(
      env,
      (codigo) => { throw new Saiu(codigo); },
      (texto) => { saida += texto; },
    );
    return { arrancou: true, saida };
  } catch (e) {
    if (e instanceof Saiu) return { arrancou: false, codigo: e.codigo, saida };
    throw e;
  }
}

const VALIDO = "a".repeat(32);

test("produção sem BAN_HASH_PEPPER: recusa arrancar", () => {
  const r = arrancar({ NODE_ENV: "production" });
  assert.equal(r.arrancou, false);
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /BAN_HASH_PEPPER em falta/);
});

test("produção com BAN_HASH_PEPPER vazio ou só espaços: recusa arrancar", () => {
  for (const v of ["", "   "]) {
    const r = arrancar({ NODE_ENV: "production", BAN_HASH_PEPPER: v });
    assert.equal(r.arrancou, false);
    assert.match(r.saida, /BAN_HASH_PEPPER em falta/);
  }
});

test("produção com BAN_HASH_PEPPER curto: recusa arrancar e não imprime o valor", () => {
  const curto = "segredo-curto-XYZ-31-caracteres"; // 31 caracteres
  assert.equal(curto.length, 31);
  const r = arrancar({ NODE_ENV: "production", BAN_HASH_PEPPER: curto });
  assert.equal(r.arrancou, false);
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /BAN_HASH_PEPPER inválida/);
  assert.ok(!r.saida.includes(curto), "a mensagem não pode conter o valor");
});

test("produção com BAN_HASH_PEPPER válido (>= 32 caracteres): arranca", () => {
  const r = arrancar({ NODE_ENV: "production", BAN_HASH_PEPPER: VALIDO });
  assert.equal(r.arrancou, true);
  assert.equal(r.saida, "");
});

test("desenvolvimento sem BAN_HASH_PEPPER: arranca", () => {
  assert.equal(arrancar({ NODE_ENV: "development" }).arrancou, true);
});

test("testes e valor curto fora de produção: arranca", () => {
  assert.equal(arrancar({ NODE_ENV: "test" }).arrancou, true);
  assert.equal(arrancar({ NODE_ENV: "development", BAN_HASH_PEPPER: "curto" }).arrancou, true);
});

// Processo real: confirma o código de saída e que o valor nunca aparece no stderr.

function correrProcesso(env: Record<string, string>): { status: number | null; stderr: string } {
  const modulo = fileURLToPath(new URL("./ambienteArranque.ts", import.meta.url));
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", "-e", `import(${JSON.stringify(modulo)}).then((m) => m.garantirAmbienteArranque())`],
    { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" },
  );
  return { status: r.status, stderr: r.stderr };
}

test("processo em produção sem BAN_HASH_PEPPER sai com código 1", () => {
  const r = correrProcesso({ NODE_ENV: "production" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /BAN_HASH_PEPPER em falta/);
});

test("processo em produção com valor curto sai com código 1 sem mostrar o valor", () => {
  const r = correrProcesso({ NODE_ENV: "production", BAN_HASH_PEPPER: "valor-secreto-curto" });
  assert.equal(r.status, 1);
  assert.ok(!r.stderr.includes("valor-secreto-curto"));
});

test("processo em produção com valor válido termina normalmente (0)", () => {
  assert.equal(correrProcesso({ NODE_ENV: "production", BAN_HASH_PEPPER: VALIDO }).status, 0);
});

test("processo em desenvolvimento sem BAN_HASH_PEPPER termina normalmente (0)", () => {
  assert.equal(correrProcesso({ NODE_ENV: "development" }).status, 0);
});
