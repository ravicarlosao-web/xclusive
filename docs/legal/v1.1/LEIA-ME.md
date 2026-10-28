# Textos legais v1.1

Os textos jurídicos vêm do advogado e são publicados **palavra por palavra**.

- `originais/*.docx` são a fonte (não editar).
- `*.json` são **gerados** por `node scripts/legal/docx-para-json.mjs` (`pnpm legal:gerar`). Não editar à mão.
- `alteracoes.json` lista as ÚNICAS alterações ao texto do advogado (decididas pelo dono): cada entrada tem o texto
  original exato do parágrafo e o resultado, com `{{NOME}}` (valor de `GET /api/auth/legal-config`) e `{{?NOME}}…{{/}}` (cláusula opcional).
- `node scripts/legal/verificar.mjs` (`pnpm legal:verificar`) corre no `build` do `@workspace/xclusive` e falha se o JSON
  divergir do .docx + manifesto, se restar `{{…}}`, `[..]`, `{..}` ou texto de placeholder antigo, ou se a versão/data
  do documento divergir de `LEGAL_DOCS` (`artifacts/api-server/src/routes/auth.ts`).

Nova versão dos documentos: substituir os .docx (nova pasta `v1.2`), atualizar o manifesto, gerar, atualizar `LEGAL_DOCS`.
