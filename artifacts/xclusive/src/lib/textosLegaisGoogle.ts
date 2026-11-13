/**
 * Textos do login com o Google que SÓ o advogado pode fornecer (documento «Textos para o Ecrã», v2.2: A a D, palavra por palavra; E e F não são ecrãs da plataforma). Nada aqui foi inventado: se um valor voltar a `null` o ecrã mostra o marcador
 * «[TEXTO DO ADVOGADO: …]» (visível de propósito) e `node scripts/pre-lancamento.mjs` (repositório de testes; fora da bateria completa) FALHA.
 * Para fechar um ponto: pôr o texto no valor (string) e o marcador desaparece do ecrã.
 */
export const TEXTOS_ADVOGADO_GOOGLE: Record<ChaveTextoGoogle, string | null> = {
  // 1. Passo de conclusão da conta: tratamento dos dados recebidos da Google (nome, email, identificador) e papel da Google.
  tratamentoDadosConclusao: 'Confirmou a ligação da sua conta Google. A Xclusive guardou o seu nome, email e identificador da conta Google para criar e gerir a sua conta. Pode desligar o Google nas Definições, sem prejuízo da manutenção da sua conta Xclusive.',
  // 2. Aviso junto ao botão «Continuar com o Google» (login e registo).
  avisoJuntoAoBotao: 'Ao continuar, será aberta uma janela de autenticação do Google. A Xclusive receberá o seu nome, email e identificador da conta Google para criar ou aceder à sua conta. Consulte a nossa Política de Privacidade e os Termos e Condições de Utilização.',
  // 3. Carregamento do script da Google nestas páginas e cookies/armazenamento que isso implica.
  scriptECookies: 'Utilizamos cookies e o script da Google nas páginas de entrada, registo e Definições para permitir o início de sessão com a conta Google, garantir segurança e melhorar a experiência. Ao continuar, aceita a utilização de cookies necessários. Consulte a nossa Política de Cookies e a Política de Privacidade.',
  // 4. Explicação de «Ligar o Google» em Definições (o que passa a ser possível, como desligar).
  explicacaoLigarGoogle: 'Ligar o Google permite iniciar sessão na Xclusive através da sua conta Google. A Xclusive receberá e guardará o identificador e o email da sua conta Google. Pode desligar esta ligação a qualquer momento nas Definições.',
};

export type ChaveTextoGoogle = 'tratamentoDadosConclusao' | 'avisoJuntoAoBotao' | 'scriptECookies' | 'explicacaoLigarGoogle';

/** O que se mostra no lugar de cada texto enquanto o advogado não o fornecer. */
export const MARCADORES_GOOGLE: Record<ChaveTextoGoogle, string> = {
  tratamentoDadosConclusao: '[TEXTO DO ADVOGADO: tratamento dos dados recebidos da Google (nome, email e identificador) e papel da Google]',
  avisoJuntoAoBotao: '[TEXTO DO ADVOGADO: aviso junto ao botão «Continuar com o Google»]',
  scriptECookies: '[TEXTO DO ADVOGADO: carregamento do script da Google e cookies]',
  explicacaoLigarGoogle: '[TEXTO DO ADVOGADO: explicação de «Ligar o Google» e de como desligar]',
};
