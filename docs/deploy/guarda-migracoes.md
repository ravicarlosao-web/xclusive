# Guarda de migrações do deploy

**Problema (#138):** o código foi para produção antes de a migração estar aplicada. **Solução:** o deploy chama `scripts/verificar-migracoes.mjs` ANTES do build e do `pm2 restart`; se houver ficheiros em `lib/db/src/migrations` que não estejam registados na tabela `schema_migracoes`, o deploy **recusa** (código de saída 1) e diz quais são.

- A **aplicação não lê** a tabela `schema_migracoes`; só o script (só leitura, transação `READ ONLY`).
- Não substitui aplicar a migração: continua a ser **«aplicar no Neon ANTES do deploy»**; a guarda só impede esquecê-lo.

## O que está no repositório
| Ficheiro | Para quê |
|---|---|
| `lib/db/src/migrations/add_schema_migracoes.sql` | cria a tabela `schema_migracoes (nome text primary key, aplicada_em timestamptz default now())` e regista-se a si própria |
| `lib/db/src/migrations-reversao/reverter_schema_migracoes.sql` | apaga a tabela (ver «Reverter») |
| `scripts/verificar-migracoes.mjs` | a guarda (e o `--gerar-baseline`) |
| `scripts/migracoes-sem-registo.txt` | lista FECHADA das migrações anteriores à guarda (isentas da convenção) |
| `docs/deploy/deploy.exemplo.sh` | exemplo ilustrativo de um deploy com a guarda no sítio certo |

## Instalar — por esta ordem
1. **Ramo de segurança no Neon** (ponto de retorno), como nas outras migrações.
2. **Aplicar a migração da guarda** no Neon (SQL editor ou `psql`): conteúdo de `lib/db/src/migrations/add_schema_migracoes.sql`. É idempotente.
3. **Gerar o baseline** (não escreve na base de dados; corre onde o repositório está, sem precisar de ligação):
   ```bash
   pnpm --filter @workspace/scripts exec tsx verificar-migracoes.mjs --gerar-baseline > baseline.sql
   ```
4. **Confirmar que TODAS as migrações listadas já estão aplicadas em produção** (para cada uma: a tabela/coluna/índice que ela cria existe). Se alguma ainda não estiver (por exemplo a migração de uma PR que ainda não foi para produção), **tira essa linha do `baseline.sql` e aplica-a primeiro**: se a registares sem a aplicar, a guarda deixa-a passar sem estar aplicada.
5. **Colar o `baseline.sql` no Neon** e executar. Conferir: `select count(*) from schema_migracoes;` (deve igualar o número de ficheiros) e, no servidor, `pnpm --filter @workspace/scripts exec tsx verificar-migracoes.mjs` deve dizer «✅ … registadas» (código 0).
6. **Só depois**, instalar a guarda no `~/deploy.sh` da VPS (secção seguinte). Antes do passo 5 a guarda recusa sempre o deploy.

## Instalar a guarda no `~/deploy.sh` (UM comando, protegido)
Este PR **não** altera o `~/deploy.sh` (está fora do repositório). O `deploy.exemplo.sh` só mostra o sítio certo; o conteúdo do real não foi lido. **Antes**, vê as linhas relevantes (só leitura): `grep -nE 'build|pm2' ~/deploy.sh`.
O comando abaixo: faz cópia de segurança datada, procura a PRIMEIRA linha de build (`pnpm/npm/yarn … build`), insere a linha da guarda imediatamente antes, confirma que a linha ficou (antes do `pm2 restart/reload` e com sintaxe válida) e só então escreve «OK». Se algo falhar, repõe a cópia e não deixa nada alterado. Se o repositório na VPS não estiver em `~/xclusive`, define `XCLUSIVE_DIR` no deploy (ou edita o caminho na linha).
```bash
D=~/deploy.sh; C=0; B=$D.antes-da-guarda.$(date +%F-%H%M); L='( cd "${XCLUSIVE_DIR:-$HOME/xclusive}" && pnpm --filter @workspace/scripts exec tsx verificar-migracoes.mjs ) || { echo "DEPLOY RECUSADO: migrações por aplicar"; exit 1; }   # GUARDA-MIGRACOES'; N=$(grep -nE '^[[:space:]]*[^#]*(pnpm|npm|yarn)[^#]*[[:space:]]build' "$D" | head -1 | cut -d: -f1); { [ -n "$N" ] && ! grep -q GUARDA-MIGRACOES "$D" && cp -a "$D" "$B" && C=1 && sed -i "${N}i\\$L" "$D" && grep -q GUARDA-MIGRACOES "$D" && [ "$(grep -n GUARDA-MIGRACOES "$D" | head -1 | cut -d: -f1)" -lt "$(grep -nE 'pm2 (restart|reload)' "$D" | head -1 | cut -d: -f1)" ] && bash -n "$D" && echo "OK: guarda instalada antes do build (cópia em $B)"; } || { echo "NÃO INSTALADA (sem linha de build, guarda já presente ou verificação falhou): o ficheiro ficou como estava"; [ "$C" = 1 ] && cp -a "$B" "$D"; }
```
Teste (sem efeitos): `bash ~/deploy.sh` com a base certa continua a funcionar; com uma migração por registar pára com «DEPLOY RECUSADO» antes do build.

## O dia a dia
1. **Convenção para cada migração nova:** o ficheiro inclui, no fim (antes das consultas de verificação), a linha
   ```sql
   INSERT INTO schema_migracoes (nome) VALUES ('<nome-do-ficheiro>.sql') ON CONFLICT DO NOTHING;
   ```
   Assim, ao aplicar a migração no Neon, ela fica registada na mesma operação. Um teste (`migracoes-convencao`, repositório de testes) **falha** se um ficheiro novo não a tiver; as migrações antigas estão em `scripts/migracoes-sem-registo.txt` (lista fechada: não se acrescentam nomes).
2. **Fluxo de uma migração nova:** aplicar no Neon (regista-se sozinha) → deploy (a guarda confirma) → restart.
3. **Se a guarda recusar:** a saída lista os ficheiros por aplicar. Aplica-os no Neon e repete o deploy. «A guarda ainda não foi instalada» = faltam os passos 2–5 acima.
4. **Se a base de dados não responder:** a guarda sai com 1 e diz porquê (ligação recusada, tempo esgotado, `DATABASE_URL` em falta). O deploy não avança em silêncio.
5. **EMERGÊNCIA — ignorar a guarda** (por exemplo, o Neon está em baixo e é preciso reverter o código): `PULAR_GUARDA_MIGRACOES=1 bash ~/deploy.sh`. O script imprime um aviso grande («A GUARDA DE MIGRAÇÕES FOI IGNORADA») e sai com 0. Confirma tu à mão que não há migrações por aplicar.

## Reverter (secção à parte)
- **Tirar a guarda do deploy:** repor a cópia datada: `cp -a ~/deploy.sh.antes-da-guarda.<data> ~/deploy.sh` (ou apagar a linha marcada `# GUARDA-MIGRACOES`).
- **Apagar a tabela** (só se já não a quiseres): aplicar `lib/db/src/migrations-reversao/reverter_schema_migracoes.sql`. Sem a tabela, uma guarda que continue instalada recusa o deploy («ainda não foi instalada»): tira-a primeiro do deploy ou usa `PULAR_GUARDA_MIGRACOES=1`.
