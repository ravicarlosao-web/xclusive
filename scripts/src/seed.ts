/**
 * Script de seed — apenas para desenvolvimento/teste.
 * Cria 3 contas de teste: utilizador, criador e administrador.
 * É idempotente: usa ON CONFLICT DO NOTHING, seguro de correr várias vezes.
 *
 * Executado automaticamente pelo scripts/post-merge.sh após `drizzle push`.
 */

import "dotenv/config";
import path from "node:path";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

import { db, pool } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";

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
  {
    username: "admin_teste",
    email: "admin@xclusive.ao",
    nomeExibicao: "Administrador",
    tipoConta: "pessoal" as const,
    verificado: true,
    role: "admin",
    bio: "Conta de administrador para testes.",
  },
];

async function seed() {
  console.log("🌱 A iniciar seed da base de dados...");

  const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

  for (const u of SEED_USERS) {
    await db
      .insert(usersTable)
      .values({
        username: u.username,
        email: u.email,
        passwordHash,
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
  console.log("   admin@xclusive.ao   — administrador");

  await pool.end();
}

seed().catch((err) => {
  console.error("❌ Erro no seed:", err);
  process.exit(1);
});
