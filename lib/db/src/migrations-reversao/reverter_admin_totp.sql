-- ─────────────────────────────────────────────────────────────────────────────
-- REVERSÃO de add_admin_totp.sql. NÃO está em migrations/ de propósito. ATENÇÃO: apaga as tabelas e o TOTP de TODOS os admins (eles voltam a entrar só com a palavra-passe).
-- Reverter ANTES também o deploy (o código novo consulta estas tabelas), ou, com o código novo ainda no ar, as rotas de TOTP respondem 503 (as contas sem TOTP continuam a entrar).
-- Confirma que nenhum admin depende do TOTP (um admin com TOTP ativo não entra sem o segundo passo enquanto o código novo estiver no ar).
-- ─────────────────────────────────────────────────────────────────────────────

-- Pré-verificação (ANTES): quantas contas com TOTP ativo e códigos de recuperação serão perdidos.
SELECT (SELECT count(*) FROM admin_totp WHERE ativado_em IS NOT NULL) AS contas_com_totp_ativo, (SELECT count(*) FROM admin_totp_recuperacao) AS codigos_de_recuperacao;

-- Instrução 1 (aplicar sozinha):
DROP TABLE IF EXISTS admin_totp_recuperacao;

-- Instrução 2 (aplicar sozinha):
DROP TABLE IF EXISTS admin_totp;

-- Verificação (DEPOIS): 0 tabelas.
SELECT count(*) AS tabelas_restantes FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('admin_totp', 'admin_totp_recuperacao');
