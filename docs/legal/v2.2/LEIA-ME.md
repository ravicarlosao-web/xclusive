# Textos legais v2.2

Em vigor para **Termos e Condições de Utilização**, **Política de Privacidade** e **Política de Cookies** (chave nova `cookies` em `LEGAL_DOCS`).
Os outros documentos públicos estão na v2.3 (`../v2.3`: Conteúdo, Reembolsos e Pagamentos, Direitos de Autor e Criadoras) e, o Modelo de Consentimento de Terceiros, na v1.1 (`../v1.1`).
A v1.1 de Termos e Privacidade fica na pasta só como histórico (já não é gerada nem importada).

- `originais/*.docx` são a fonte (do advogado; não editar). `*.json` são **gerados** por `node scripts/legal/docx-para-json.mjs` (`pnpm legal:gerar`).
- `alteracoes.json`: SEM alterações ao texto do advogado nesta versão (os documentos v2.2 já não têm tokens nem campos por preencher).
- Data de entrada em vigor: a ÚNICA alteração ao texto do advogado fora do manifesto é a frase «Data de entrada em vigor: a definir na publicação» → «Data de entrada em vigor: <data>», com a data de `../data-entrada-em-vigor.json`
  (autorização escrita do advogado; valor único para os 7 documentos publicados). `node scripts/pre-lancamento.mjs` (repositório de testes) falha se essa frase voltar ou se houver qualquer marca entre parênteses retos nos textos publicados (exceto os campos em branco do Modelo de Consentimento).
- Os textos do ecrã do login com o Google (A a D do documento «Textos para o Ecrã» v2.2) estão em `artifacts/xclusive/src/lib/textosLegaisGoogle.ts`, palavra por palavra.
  Os E e F desse documento não são ecrãs da plataforma (consentimento OAuth na Google Cloud Console e confirmação sobre documentos).
- Os documentos «Respostas Escritas» e «Textos para o Ecrã» são internos: não entram no código nem no bundle.
