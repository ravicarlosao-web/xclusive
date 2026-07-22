import { useState } from 'react';
import { Search, Hash } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useGetExplore, useSearch, SearchType } from '@workspace/api-client-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Link } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { MOCK_FEED_POSTS } from '@/data/mockPosts';

const CATEGORIES = ['Tudo', 'Moda', 'Fitness', 'Culinária', 'Arte', 'Música', 'Viagens'];

export default function Explore() {
  const [category, setCategory] = useState('Tudo');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchTab, setActiveSearchTab] = useState<'accounts' | 'hashtags'>('accounts');
  const { isMockMode } = useAuth();

  const { data: exploreData, isLoading } = useGetExplore(
    { category: category === 'Tudo' ? undefined : category },
    { query: { queryKey: ['/api/explore', category] } }
  );

  const { data: searchResults, isLoading: isSearching } = useSearch(
    { q: searchQuery },
    { query: { queryKey: ['/api/search', searchQuery], enabled: searchQuery.length > 1 } }
  );

  const gridPosts = isMockMode && !exploreData?.posts?.length
    ? MOCK_FEED_POSTS
    : (exploreData?.posts ?? []);

  return (
    <div className="w-full max-w-screen-xl mx-auto pb-20 md:pb-0 h-screen overflow-hidden flex flex-col">

      {/* Cabeçalho fixo — só contém barra de pesquisa e controlos de filtro/tab */}
      <div className="px-4 sm:px-8 py-6 border-b border-border bg-background/95 backdrop-blur z-10 sticky top-0">
        <div className="relative mb-6">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-muted-foreground" />
          </div>
          <Input
            type="search"
            placeholder="Pesquisar contas ou hashtags..."
            className="w-full pl-10 h-12 bg-secondary/50 rounded-xl border-transparent focus:border-primary"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setActiveSearchTab('accounts'); }}
          />
        </div>

        {!searchQuery ? (
          /* Filtros de categoria */
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`whitespace-nowrap px-5 py-2 rounded-full text-sm font-semibold transition-all ${
                  category === cat
                    ? 'bg-primary text-white shadow-[0_0_15px_rgba(255,62,114,0.4)]'
                    : 'bg-secondary text-foreground hover:bg-secondary/80'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        ) : (
          /* Tab switcher para resultados de pesquisa */
          <div className="flex gap-2">
            <button
              onClick={() => setActiveSearchTab('accounts')}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeSearchTab === 'accounts'
                  ? 'bg-primary text-white shadow-[0_0_15px_rgba(255,62,114,0.3)]'
                  : 'bg-secondary text-foreground hover:bg-secondary/80'
              }`}
            >
              Contas
            </button>
            <button
              onClick={() => setActiveSearchTab('hashtags')}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeSearchTab === 'hashtags'
                  ? 'bg-primary text-white shadow-[0_0_15px_rgba(255,62,114,0.3)]'
                  : 'bg-secondary text-foreground hover:bg-secondary/80'
              }`}
            >
              Hashtags
            </button>
          </div>
        )}
      </div>

      {/* Área de conteúdo com scroll */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 custom-scrollbar">
        {searchQuery ? (
          /* Resultados de pesquisa */
          <div className="flex flex-col gap-2 max-w-2xl mx-auto">
            {activeSearchTab === 'accounts' ? (
              <>
                {isSearching ? (
                  Array(4).fill(0).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 p-3">
                      <Skeleton className="w-12 h-12 rounded-full shrink-0" />
                      <div className="flex flex-col gap-2">
                        <Skeleton className="h-4 w-36" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  ))
                ) : searchResults?.accounts && searchResults.accounts.length > 0 ? (
                  searchResults.accounts.map(user => (
                    <Link key={user.id} href={`/perfil/${user.username}`}>
                      <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors cursor-pointer">
                        <Avatar className="w-12 h-12 shrink-0">
                          <AvatarImage src={user.avatarUrl || ''} />
                          <AvatarFallback>{user.username[0]}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="font-bold flex items-center gap-1">
                            {user.username}
                            {user.verificado && (
                              <svg className="w-3.5 h-3.5 text-primary fill-current" viewBox="0 0 24 24">
                                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z"/>
                              </svg>
                            )}
                          </span>
                          <span className="text-sm text-muted-foreground">{user.nomeExibicao}</span>
                        </div>
                      </div>
                    </Link>
                  ))
                ) : searchResults ? (
                  <p className="text-center text-muted-foreground py-12">Nenhuma conta encontrada para "{searchQuery}".</p>
                ) : null}
              </>
            ) : (
              /* Hashtags */
              <>
                {isSearching ? (
                  Array(4).fill(0).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 p-3">
                      <Skeleton className="w-12 h-12 rounded-full shrink-0" />
                      <div className="flex flex-col gap-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                  ))
                ) : searchResults?.hashtags && searchResults.hashtags.length > 0 ? (
                  searchResults.hashtags.map(tag => (
                    <div
                      key={tag.nome}
                      className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors cursor-pointer"
                    >
                      <div className="w-12 h-12 bg-secondary rounded-full flex items-center justify-center shrink-0">
                        <Hash className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-bold">#{tag.nome}</span>
                        <span className="text-sm text-muted-foreground">
                          {tag.totalPosts.toLocaleString('pt-PT')} publicações
                        </span>
                      </div>
                    </div>
                  ))
                ) : searchResults ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Hash className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p>Nenhuma hashtag encontrada para "{searchQuery}".</p>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : (
          /* Grelha mosaico */
          <div className="grid grid-cols-3 gap-1 sm:gap-4 max-w-screen-lg mx-auto">
            {isLoading && !isMockMode ? (
              Array(12).fill(0).map((_, i) => (
                <Skeleton key={i} className={`rounded-sm sm:rounded-xl w-full ${i % 7 === 0 ? 'col-span-2 row-span-2 aspect-square' : 'aspect-square'}`} />
              ))
            ) : (
              gridPosts.map((post, i) => (
                <Link
                  key={post.id}
                  href={`/perfil/${post.autor.username}`}
                  className={`relative bg-secondary group cursor-pointer overflow-hidden rounded-sm sm:rounded-xl block
                    ${i % 7 === 0 ? 'col-span-2 row-span-2 aspect-square' : 'aspect-square'}`}
                >
                  {post.media && post.media.length > 0 ? (
                    post.media[0].tipo === 'imagem' ? (
                      <img src={post.media[0].url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <video src={post.media[0].url} className="w-full h-full object-cover" muted preload="metadata" />
                    )
                  ) : null}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-6 text-white font-bold">
                    <div className="flex items-center gap-2">
                      <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                      {post.totalCurtidas}
                    </div>
                    <div className="flex items-center gap-2">
                      <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
                      {post.totalComentarios}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
