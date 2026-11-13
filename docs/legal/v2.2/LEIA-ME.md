# Textos legais v2.2

Em vigor para **Termos e Condições de Utilização**, **Política de Privacidade** e **Política de Cookies** (chave nova `cookies` em `LEGAL_DOCS`).
Os restantes documentos (Política de Conteúdo, Direitos de Autor, Reembolsos, Termos para Criadoras e Modelo de Consentimento) continuam na v1.1
(`../v1.1`) até chegarem os v2.3. A v1.1 de Termos e Privacidade fica na pasta só como histórico (já não é gerada nem importada).

- `originais/*.docx` são a fonte (do advogado; não editar). `*.json` são **gerados** por `node scripts/legal/docx-para-json.mjs` (`pnpm legal:gerar`).
- `alteracoes.json`: SEM alterações ao texto do advogado nesta versão (os documentos v2.2 já não têm tokens nem campos por preencher).
- «Data de entrada em vigor: a definir na publicação» fica no texto até à publicação; `node scripts/pre-lancamento.mjs` (repositório de testes) falha enquanto
  existir essa frase ou qualquer marca entre parênteses retos nos textos publicados (exceto os campos em branco do Modelo de Consentimento).
- Os textos do ecrã do login com o Google (A a D do documento «Textos para o Ecrã» v2.2) estão em `artifacts/xclusive/src/lib/textosLegaisGoogle.ts`, palavra por palavra.
  Os E e F desse documento não são ecrãs da plataforma (consentimento OAuth na Google Cloud Console e confirmação sobre documentos).
- Os documentos «Respostas Escritas» e «Textos para o Ecrã» são internos: não entram no código nem no bundle.
