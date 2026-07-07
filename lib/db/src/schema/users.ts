import { pgTable, serial, text, boolean, timestamp, pgEnum, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tipoContaEnum = pgEnum("tipo_conta", ["pessoal", "criador"]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  nomeExibicao: varchar("nome_exibicao", { length: 100 }).notNull(),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  capaUrl: text("capa_url"),
  link: text("link"),
  tipoConta: tipoContaEnum("tipo_conta").notNull().default("pessoal"),
  verificado: boolean("verificado").notNull().default(false),
  privado: boolean("privado").notNull().default(false),
  dataNascimento: text("data_nascimento"),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, criadoEm: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
