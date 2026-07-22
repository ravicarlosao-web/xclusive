import { cn } from "@/lib/utils";

export type StatusVariant = 
  | 'ativo' | 'suspenso' | 'eliminado' | 'pendente' | 'aprovado' | 'rejeitado' | 'pago' | 'reviewing' | 'resolved' | 'dismissed';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const normalizedStatus = status.toLowerCase();
  
  let variantClass = "bg-gray-500/20 text-gray-400 border-gray-500/30"; // default
  
  switch (normalizedStatus) {
    case 'ativo':
    case 'pago':
      variantClass = "bg-green-500/10 text-green-400 border-green-500/20";
      break;
    case 'suspenso':
    case 'reviewing':
      variantClass = "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
      break;
    case 'eliminado':
    case 'rejeitado':
      variantClass = "bg-red-500/10 text-red-400 border-red-500/20";
      break;
    case 'aprovado':
      variantClass = "bg-blue-500/10 text-blue-400 border-blue-500/20";
      break;
    case 'pendente':
    case 'resolved':
    case 'dismissed':
      variantClass = "bg-gray-500/10 text-gray-400 border-gray-500/20";
      break;
  }

  return (
    <span className={cn(
      "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border uppercase tracking-wider",
      variantClass,
      className
    )}>
      {status}
    </span>
  );
}
