-- ─────────────────────────────────────────────────────────────────────────────
-- REVERSÃO de add_boas_vindas.sql. NÃO está em migrations/ de propósito. ATENÇÃO: apaga as 2 tabelas e o que tiverem (configurações das criadoras e o registo
-- de quem já recebeu a mensagem: sem ele, ao voltar a ligar, as pessoas voltariam a poder receber). As mensagens JÁ entregues ficam em messages (não se apagam).
-- Antes: desligar o interruptor (apagar a linha 'boas_vindas_ativas' de platform_settings) e reverter o deploy (o código novo usa estas tabelas).
-- ─────────────────────────────────────────────────────────────────────────────

-- Pré-verificação (ANTES): o que se perde.
SELECT (SELECT count(*) FROM boas_vindas_config) AS configs, (SELECT count(*) FROM boas_vindas_envios) AS envios;

-- Instrução 1 (aplicar sozinha):
DROP TABLE IF EXISTS boas_vindas_envios;

-- Instrução 2 (aplicar sozinha):
DROP TABLE IF EXISTS boas_vindas_config;

-- Instrução 3 (aplicar sozinha): retirar o registo da migração (para a guarda do deploy voltar a pedi-la).
DELETE FROM schema_migracoes WHERE nome = 'add_boas_vindas.sql';
