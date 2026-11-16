# Textos legais v2.2.1

Em vigor para **Termos e Condições de Utilização**, **Política de Privacidade** e **Política de Cookies** (`LEGAL_DOCS` com a versão `2.2.1`). Versão de **correção**, sem alteração substantiva: identificação da operadora (ORIGEM — COMÉRCIO E PRESTAÇÃO DE SERVIÇOS, contacto legal@xclusive.ao) nos três e, nos Cookies, retirada da referência à confirmação de maioridade guardada no navegador. A v2.2 fica na pasta `../v2.2` só como histórico (já não é gerada nem importada).
Os outros documentos públicos estão na v2.3 (`../v2.3`: Conteúdo, Reembolsos e Pagamentos, Direitos de Autor e Criadoras) e, o Modelo de Consentimento de Terceiros, na v1.1 (`../v1.1`).
A v1.1 de Termos e Privacidade fica na pasta só como histórico (já não é gerada nem importada).

- `originais/*.docx` são a fonte (do advogado; não editar). `*.json` são **gerados** por `node scripts/legal/docx-para-json.mjs` (`pnpm legal:gerar`).
- `alteracoes.json`: SEM alterações ao texto do advogado nesta versão (os documentos já não têm tokens nem campos por preencher).
- Data de entrada em vigor: a ÚNICA alteração ao texto do advogado fora do manifesto é a frase «Data de entrada em vigor: [dia do lançamento público]» (o marcador que o advogado deixou nesta versão) → «Data de entrada em vigor: <data>», com a data de `../data-entrada-em-vigor.json` (a mesma regra e o mesmo valor da v2.2, que usava «a definir na publicação»)
  (autorização escrita do advogado para a frase da v2.2; o mapeamento do marcador da v2.2.1 para a mesma data é instrução do dono do produto; valor único para os 7 documentos publicados). `node scripts/pre-lancamento.mjs` (repositório de testes) falha se essa frase voltar ou se houver qualquer marca entre parênteses retos nos textos publicados (exceto os campos em branco do Modelo de Consentimento).
- Os textos do ecrã do login com o Google (A a D do documento «Textos para o Ecrã» v2.2) estão em `artifacts/xclusive/src/lib/textosLegaisGoogle.ts`, palavra por palavra.
  Os E e F desse documento não são ecrãs da plataforma (consentimento OAuth na Google Cloud Console e confirmação sobre documentos).
- Os documentos «Respostas Escritas» e «Textos para o Ecrã» são internos: não entram no código nem no bundle.
