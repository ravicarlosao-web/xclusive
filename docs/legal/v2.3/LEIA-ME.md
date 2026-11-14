# Textos legais v2.3

Em vigor para **Política de Conteúdo**, **Política de Reembolsos e Pagamentos**, **Direitos de Autor e Pedidos de Retirada** e **Termos para Criadoras**.
Os outros três documentos públicos estão na v2.2 (`../v2.2`: Termos e Condições, Privacidade e Cookies). Só o Modelo de Consentimento de Terceiros ficou na v1.1 (`../v1.1`);
o resto da v1.1 fica nas pastas só como histórico (já não é gerado nem importado).

- `originais/*.docx` são a fonte (do advogado; não editar). `*.json` são **gerados** por `node scripts/legal/docx-para-json.mjs` (`pnpm legal:gerar`).
- `alteracoes.json`: SEM alterações ao texto do advogado (os documentos v2.3 não têm tokens nem campos por preencher).
- Lista de documentos aceites no registo (documento «Respostas Escritas» v2.2, n.º 2): Termos e Condições de Utilização, Política de Privacidade, Política de Cookies,
  Política de Conteúdo, Política de Reembolsos e Pagamentos e Política de Direitos de Autor e Pedidos de Retirada. NÃO entram: Procedimento sobre Menores, Política de Retenção e
  Apagamento de Dados e Modelo de Consentimento de Terceiros (internos, disponíveis mediante pedido). Os Termos para Criadoras são aceites à parte, ao tornar-se criadora.
- Dados factuais: o levantamento mínimo é o valor em vigor (`GET /auth/legal-config`, de `platform_settings.min_withdrawal_amount`), o prazo de pagamento é de 4 dias úteis após a
  aprovação do pedido e a página de levantamentos é `/definicoes/monetizacao`. `scripts/legal/verificar.mjs` confere o prazo e a página dos textos com o código.
- «Data de entrada em vigor: a definir na publicação» fica no texto até à publicação; `node scripts/pre-lancamento.mjs` (repositório de testes) falha enquanto existir.
