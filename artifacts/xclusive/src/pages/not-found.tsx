import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { usePageMeta } from '@/hooks/usePageMeta';

export default function NotFound() {
  usePageMeta({
    title: 'Página não encontrada — Xclusive',
    description: 'A página que procuras não existe ou foi movida.',
    noindex: true,
  });

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background text-foreground px-4 text-center">
      <p className="text-sm font-bold uppercase tracking-wider text-primary mb-3">Erro 404</p>
      <h1 className="text-3xl sm:text-4xl font-extrabold mb-4">Página não encontrada</h1>
      <p className="text-muted-foreground max-w-md mb-8">
        A página que procuras não existe ou foi movida. Volta ao início para continuares a explorar o Xclusive.
      </p>
      <Link href="/">
        <Button className="rounded-full px-8">Voltar ao início</Button>
      </Link>
    </div>
  );
}
