/**
 * Script de seed — apenas para desenvolvimento/teste.
 * Cria 2 contas de teste (utilizador e criador). Uma conta de administrador só é criada se
 * SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD estiverem definidas (nunca há admin com password fixa).
 * Recusa correr fora de NODE_ENV=development. É idempotente (ON CONFLICT DO NOTHING).
 *
 * Executado pelo scripts/post-merge.sh só quando NODE_ENV=development.
 */

import "dotenv/config";
import path from "node:path";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

import { db, pool } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";

// Fail-closed: o seed cria contas com password conhecida, por isso só corre com NODE_ENV=development explícito.
if (process.env.NODE_ENV !== "development") {
  console.error("❌ Seed recusado: só corre com NODE_ENV=development (valor atual: " + (process.env.NODE_ENV ?? "não definido") + ").");
  process.exit(1);
}

const PASSWORD = "password123";
const SALT_ROUNDS = 10;

const SEED_USERS = [
  {
    username: "fan_teste",
    email: "fan@xclusive.ao",
    nomeExibicao: "Fã de Teste",
    tipoConta: "pessoal" as const,
    verificado: false,
    role: "user",
    bio: "Conta de fã para testes.",
  },
  {
    username: "criador_teste",
    email: "criador@xclusive.ao",
    nomeExibicao: "Criador de Teste",
    tipoConta: "criador" as const,
    verificado: true,
    role: "user",
    bio: "Conta de criador verificado para testes.",
  },
];

// Admin opcional, só com credenciais vindas do ambiente (nunca com password fixa no código).
const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim();
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
if (Boolean(adminEmail) !== Boolean(adminPassword)) {
  console.error("❌ Seed recusado: define SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD juntas (ou nenhuma).");
  process.exit(1);
}
if (adminPassword && adminPassword.length < 12) {
  console.error("❌ Seed recusado: SEED_ADMIN_PASSWORD deve ter pelo menos 12 caracteres.");
  process.exit(1);
}

async function seed() {
  console.log("🌱 A iniciar seed da base de dados...");

  const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

  const adminHash = adminEmail && adminPassword ? await bcrypt.hash(adminPassword, SALT_ROUNDS) : null;
  const users = adminHash
    ? [
        ...SEED_USERS.map((u) => ({ ...u, hash: passwordHash })),
        {
          username: "admin_dev",
          email: adminEmail!,
          nomeExibicao: "Administrador",
          tipoConta: "pessoal" as const,
          verificado: true,
          role: "admin",
          bio: "Conta de administrador de desenvolvimento.",
          hash: adminHash,
        },
      ]
    : SEED_USERS.map((u) => ({ ...u, hash: passwordHash }));

  for (const u of users) {
    await db
      .insert(usersTable)
      .values({
        username: u.username,
        email: u.email,
        passwordHash: u.hash,
        nomeExibicao: u.nomeExibicao,
        tipoConta: u.tipoConta,
        verificado: u.verificado,
        role: u.role,
        bio: u.bio,
        ativo: true,
        privado: false,
        saldo: "0",
        ganhos: "0",
      })
      .onConflictDoNothing();

    console.log(`  ✅ ${u.email} (${u.role})`);
  }

  console.log("");
  console.log("✅ Seed concluído! Contas de teste (password: password123):");
  console.log("   fan@xclusive.ao     — utilizador/fã");
  console.log("   criador@xclusive.ao — criador verificado");
  console.log(adminHash ? "   administrador criado com SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD" : "   (sem administrador: define SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD se precisares)");

  await pool.end();
}

seed().catch((err) => {
  console.error("❌ Erro no seed:", err);
  process.exit(1);
});
