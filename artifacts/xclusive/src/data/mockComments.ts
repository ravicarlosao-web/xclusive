import { Comment } from '@workspace/api-client-react';

/**
 * Comentários demonstrativos por post, mostrados quando a app corre em modo
 * mock (sem base de dados real ligada). Chave = id do post em MOCK_FEED_POSTS.
 */
export const MOCK_COMMENTS: Record<number, Comment[]> = {
  1001: [
    {
      id: 1,
      autor: { id: 3, username: 'marcos_beats', nomeExibicao: 'Marcos Beats', avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=marcos&backgroundColor=0d0d1a&radius=50', verificado: true },
      texto: 'A luz está incrível nesta foto 🔥',
      comentarioPaiId: null,
      respostas: [],
      totalCurtidas: 12,
      curtido: false,
      criadoEm: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
    },
    {
      id: 2,
      autor: { id: 4, username: 'sofia_fitness', nomeExibicao: 'Sofia Fitness', avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=sofia&backgroundColor=1a0a0a&radius=50', verificado: true },
      texto: 'Preciso de saber o nome desta praia já 😍',
      comentarioPaiId: null,
      respostas: [],
      totalCurtidas: 5,
      curtido: true,
      criadoEm: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    },
    {
      id: 3,
      autor: { id: 6, username: 'luna_fashion', nomeExibicao: 'Luna Fashion', avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=luna&backgroundColor=1a001a&radius=50', verificado: false },
      texto: 'A terceira foto é a minha favorita 📸',
      comentarioPaiId: null,
      respostas: [],
      totalCurtidas: 3,
      curtido: false,
      criadoEm: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
    },
  ],
  1002: [
    {
      id: 4,
      autor: { id: 2, username: 'ana_kriativa', nomeExibicao: 'Ana Kriativa', avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=ana&backgroundColor=1a1a2e&radius=50', verificado: true },
      texto: 'Já estou ansiosa para ouvir isto! 🎧',
      comentarioPaiId: null,
      respostas: [],
      totalCurtidas: 21,
      curtido: false,
      criadoEm: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    },
    {
      id: 5,
      autor: { id: 5, username: 'pedro_viagens', nomeExibicao: 'Pedro Viagens', avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=pedro&backgroundColor=0a1a0a&radius=50', verificado: true },
      texto: 'Afrohouse angolano é outro nível 🇦🇴',
      comentarioPaiId: null,
      respostas: [],
      totalCurtidas: 9,
      curtido: false,
      criadoEm: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    },
  ],
  1003: [
    {
      id: 6,
      autor: { id: 5, username: 'pedro_viagens', nomeExibicao: 'Pedro Viagens', avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=pedro&backgroundColor=0a1a0a&radius=50', verificado: true },
      texto: 'Disciplina acima de tudo mesmo 💯',
      comentarioPaiId: null,
      respostas: [],
      totalCurtidas: 14,
      curtido: false,
      criadoEm: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    },
  ],
  1004: [
    {
      id: 7,
      autor: { id: 6, username: 'luna_fashion', nomeExibicao: 'Luna Fashion', avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=luna&backgroundColor=1a001a&radius=50', verificado: false },
      texto: 'Está na minha lista de viagens este ano! ✈️',
      comentarioPaiId: null,
      respostas: [],
      totalCurtidas: 6,
      curtido: false,
      criadoEm: new Date(Date.now() - 1000 * 60 * 60 * 7).toISOString(),
    },
  ],
  1005: [
    {
      id: 8,
      autor: { id: 4, username: 'sofia_fitness', nomeExibicao: 'Sofia Fitness', avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=sofia&backgroundColor=1a0a0a&radius=50', verificado: true },
      texto: 'Combinação perfeita de cores 👏',
      comentarioPaiId: null,
      respostas: [],
      totalCurtidas: 4,
      curtido: false,
      criadoEm: new Date(Date.now() - 1000 * 60 * 60 * 11).toISOString(),
    },
  ],
  1006: [],
  1007: [
    {
      id: 9,
      autor: { id: 2, username: 'ana_kriativa', nomeExibicao: 'Ana Kriativa', avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=ana&backgroundColor=1a1a2e&radius=50', verificado: true },
      texto: 'A minha mãe também faz mufete assim, tem de haver um encontro dos dois 😂',
      comentarioPaiId: null,
      respostas: [],
      totalCurtidas: 8,
      curtido: false,
      criadoEm: new Date(Date.now() - 1000 * 60 * 60 * 29).toISOString(),
    },
  ],
};
