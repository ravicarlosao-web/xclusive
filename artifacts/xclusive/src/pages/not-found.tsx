import { Link } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';
import { RodapeLegal } from '@/components/shared/RodapeLegal';

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center gap-6 bg-background py-8">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-bold text-foreground">
              Página não encontrada
            </h1>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            A página que procuras não existe ou foi movida.
          </p>

          <Link href="/" className="mt-4 inline-flex items-center min-h-[44px] text-sm font-semibold text-primary hover:underline">
            Voltar ao início
          </Link>
        </CardContent>
      </Card>
      <RodapeLegal className="max-w-md px-4" />
    </div>
  );
}
