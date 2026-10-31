import { useRoute } from 'wouter';
import { MensagensShell } from '@/components/mensagens/MensagensShell';

/** /mensagens/:id: em md+ a mesma vista dividida com a conversa aberta; em < md a conversa em ecrã inteiro. */
export default function MessageThread() {
  const [, params] = useRoute('/mensagens/:id');
  const convId = parseInt(params?.id ?? '0', 10);
  return <MensagensShell convId={Number.isFinite(convId) ? convId : 0} />;
}
