-- Remove a funcionalidade Reels da base de dados (PR limpar-reels-backend).
--
-- QUANDO APLICAR: DEPOIS do deploy do código novo (o código novo já não lê nem escreve em `reels`).
-- NÃO aplicar antes: o código anterior ainda lê `reels` em /creator/stats e ao abrir um caso de menor.
--
-- O QUE NÃO SE TOCA (de propósito): os valores de enum report_target_type 'reel' e notification_tipo 'like_reel'
-- (o Postgres não os remove), o CHECK de infracoes_mais18.tipo_conteudo e a função proteger_prova(), que é
-- genérica e continua a proteger posts, stories, comments e live_streams.
--
-- ANTES DE APLICAR, confirma que TODAS estas consultas (só leitura) dão 0:
--
--   select count(*) from reels;
--   select count(*) from reports           where target_type = 'reel';
--   select count(*) from likes             where alvo_tipo = 'reel';
--   select count(*) from notifications     where tipo = 'like_reel';
--   select count(*) from infracoes_mais18  where tipo_conteudo = 'reel';
--   select count(*) from audit_log         where target_type = 'reel' or details::text ilike '%reel%';
--   select count(*) from menor_cases
--    where coalesce((acoes->'conteudoRetido'->>'reels')::int, 0) > 0;
--   select count(*) from identifier_blocks ib join menor_cases mc on mc.id = ib.caso_id
--    where coalesce((mc.acoes->'conteudoRetido'->>'reels')::int, 0) > 0;
--
-- O DROP TABLE leva com ela o trigger proteger_prova_reels, as duas FKs (autor_id, retirado_por) e o índice reels_pkey.
-- Nenhuma outra tabela tem FK para `reels`.

DROP TABLE IF EXISTS reels;
DROP SEQUENCE IF EXISTS reels_id_seq;
