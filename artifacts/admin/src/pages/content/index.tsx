import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Search, Trash2, Heart, MessageCircle, Play, Image as ImageIcon } from 'lucide-react';
import { format } from 'date-fns';

export default function Content() {
  const [searchTerm, setSearchTerm] = useState('');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: posts, isLoading } = useQuery({
    queryKey: ['posts'],
    queryFn: () => adminApi.getPosts()
  });

  const deletePost = useMutation({
    mutationFn: ({ id, motivo }: { id: number, motivo: string }) => adminApi.deletePost(id, motivo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      toast({ title: 'Publicação eliminada' });
    }
  });

  const handleDelete = (id: number) => {
    const motivo = prompt('Motivo da remoção (obrigatório para notificar o criador):');
    if (!motivo) return;
    deletePost.mutate({ id, motivo });
  };

  const filteredPosts = posts?.filter((p: any) => 
    p.content.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.creatorName.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Conteúdo</h1>
          <p className="text-muted-foreground">Monitorização do feed global de publicações.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Pesquisar conteúdo ou criador..."
            className="pl-9 bg-card border-border"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div>A carregar publicações...</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {filteredPosts.map((post: any) => (
            <Card key={post.id} className="border-border bg-card overflow-hidden flex flex-col">
              <div className="relative aspect-square bg-muted flex items-center justify-center">
                {post.mediaType === 'video' ? (
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                    <Play className="h-12 w-12 text-white opacity-70" />
                  </div>
                ) : (
                  <ImageIcon className="h-12 w-12 text-muted-foreground/30" />
                )}
                {/* Fallback mock image placeholder text */}
                <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded uppercase tracking-wider font-bold">
                  {post.mediaType}
                </div>
              </div>
              <CardContent className="p-4 flex-1">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-medium text-primary text-sm">@{post.creatorName}</span>
                  <span className="text-xs text-muted-foreground">{format(new Date(post.createdAt), 'dd MMM')}</span>
                </div>
                <p className="text-sm line-clamp-3 text-foreground/90">{post.content}</p>
              </CardContent>
              <CardFooter className="p-3 bg-muted/20 border-t border-border flex justify-between items-center">
                <div className="flex gap-3 text-muted-foreground text-xs font-mono">
                  <span className="flex items-center gap-1"><Heart className="h-3 w-3" /> {post.likes}</span>
                  <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" /> --</span>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => handleDelete(post.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
