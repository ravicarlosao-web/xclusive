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

## Documentos públicos 06 e 07

- `06-termos-criadoras` (chave `criadoras`, página `/termos-criadoras`): tem chave em `LEGAL_DOCS` (versão e data conferidas no build),
  mas NÃO faz parte do aceite do registo (este exige só as 5 chaves de sempre).
- `07-consentimento-terceiros` (página `/modelo-consentimento`): formulário com campos em branco `[..]` que ficam como no original.
  No `DOCUMENTOS` do gerador tem `camposEmBranco` (único documento onde `[..]` é aceite) e `semLegalDocs` (sem chave em `LEGAL_DOCS`; a versão
  e a data conferem com as dos Termos). O botão "Descarregar (.docx)" serve `artifacts/xclusive/public/documentos/modelo-consentimento-terceiros.docx`,
  cuja igualdade byte a byte com `originais/07-consentimento-terceiros.docx` é verificada no build.

## Documentos internos 08, 09 e 10 (NÃO estão no repositório)

Os documentos 08, 09 e 10 são internos: não se publicam no site, não entram no bundle e o seu conteúdo não está em lado nenhum do Git.
Guardam-se fora do repositório (arquivo privado do dono). Aqui fica só o índice, para provar qual a versão em vigor:

| Documento | Versão | Data | SHA-256 do .docx |
|---|---|---|---|
| 08 Procedimento sobre Menores | 1.1 | 22 de outubro de 2026 | `cbde635a86f5076858d6e4740914f15a7866a9f81564fa7d848ba1250f4f753e` |
| 09 Retenção e Apagamento de Dados | 1.1 | 22 de outubro de 2026 | `ddc3f93d72c9d815647debdea2843da5377f5f37b3d5cf1ebcb2cb124758cf83` |
| 10 Parecer Preliminar de Conformidade | 1.1 | 22 de outubro de 2026 | `694f5ca6c3bb932f1fa310c15fd92f97cc9acba8c03dd425bc0ae17a8062d1c1` |
