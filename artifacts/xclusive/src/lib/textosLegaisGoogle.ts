/**
 * Textos do login com o Google que SÓ o advogado pode fornecer. Nada aqui foi inventado: enquanto um valor for `null` o ecrã mostra o marcador
 * «[TEXTO DO ADVOGADO: …]» (visível de propósito) e `node scripts/pre-lancamento.mjs` (repositório de testes; fora da bateria completa) FALHA.
 * Para fechar um ponto: pôr o texto no valor (string) e o marcador desaparece do ecrã.
 */
export const TEXTOS_ADVOGADO_GOOGLE: Record<ChaveTextoGoogle, string | null> = {
  // 1. Passo de conclusão da conta: tratamento dos dados recebidos da Google (nome, email, identificador) e papel da Google.
  tratamentoDadosConclusao: null,
  // 2. Aviso junto ao botão «Continuar com o Google» (login e registo).
  avisoJuntoAoBotao: null,
  // 3. Carregamento do script da Google nestas páginas e cookies/armazenamento que isso implica.
  scriptECookies: null,
  // 4. Explicação de «Ligar o Google» em Definições (o que passa a ser possível, como desligar).
  explicacaoLigarGoogle: null,
};

export type ChaveTextoGoogle = 'tratamentoDadosConclusao' | 'avisoJuntoAoBotao' | 'scriptECookies' | 'explicacaoLigarGoogle';

/** O que se mostra no lugar de cada texto enquanto o advogado não o fornecer. */
export const MARCADORES_GOOGLE: Record<ChaveTextoGoogle, string> = {
  tratamentoDadosConclusao: '[TEXTO DO ADVOGADO: tratamento dos dados recebidos da Google (nome, email e identificador) e papel da Google]',
  avisoJuntoAoBotao: '[TEXTO DO ADVOGADO: aviso junto ao botão «Continuar com o Google»]',
  scriptECookies: '[TEXTO DO ADVOGADO: carregamento do script da Google e cookies]',
  explicacaoLigarGoogle: '[TEXTO DO ADVOGADO: explicação de «Ligar o Google» e de como desligar]',
};
