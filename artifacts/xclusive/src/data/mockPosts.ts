import { Post } from '@workspace/api-client-react';

/**
 * Posts demonstrativos mostrados no feed quando a app corre em modo mock
 * (sem base de dados real ligada).
 */
export const MOCK_FEED_POSTS: Post[] = [
  {
    id: 1001,
    autor: {
      id: 2,
      username: 'ana_kriativa',
      nomeExibicao: 'Ana Kriativa',
      avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=ana&backgroundColor=1a1a2e&radius=50',
      verificado: true,
    },
    legenda: 'Sessão fotográfica na praia de Luanda 🌊 Cada momento é único, cada luz é especial. Qual é a vossa foto favorita desta série?',
    localizacao: 'Praia da Ilha, Luanda',
    tipo: 'imagem',
    media: [
      {
        id: 1,
        url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&h=600&fit=crop',
        tipo: 'imagem',
        ordem: 0,
      },
    ],
    exclusivo: false,
    precoDesbloqueio: null,
    totalCurtidas: 1842,
    totalComentarios: 47,
    curtido: false,
    guardado: false,
    criadoEm: new Date(Date.now() - 1000 * 60 * 45).toISOString(), // 45 min atrás
  },
  {
    id: 1002,
    autor: {
      id: 3,
      username: 'marcos_beats',
      nomeExibicao: 'Marcos Beats',
      avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=marcos&backgroundColor=0d0d1a&radius=50',
      verificado: true,
    },
    legenda: '🎵 No estúdio a finalizar o novo projeto. Em breve vais ouvir algo que nunca esperavas. Stay tuned 👀\n\n#MarcosBeats #Angola #Afrohouse',
    localizacao: 'Estúdio Black Rose, Luanda',
    tipo: 'video',
    media: [
      {
        id: 2,
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        tipo: 'video',
        ordem: 0,
      },
    ],
    exclusivo: false,
    precoDesbloqueio: null,
    totalCurtidas: 3210,
    totalComentarios: 128,
    curtido: true,
    guardado: false,
    criadoEm: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2h atrás
  },
  {
    id: 1003,
    autor: {
      id: 4,
      username: 'sofia_fitness',
      nomeExibicao: 'Sofia Fitness',
      avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=sofia&backgroundColor=1a0a0a&radius=50',
      verificado: true,
    },
    legenda: 'Treino de hoje ✅ Consistência é tudo. Não precisas de motivação todos os dias — precisas de disciplina. 💪\n\nExclusivo para subscritores: plano completo de 8 semanas com dieta + treino 👇',
    localizacao: 'Luanda Sport Club',
    tipo: 'imagem',
    media: [
      {
        id: 3,
        url: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600&h=600&fit=crop',
        tipo: 'imagem',
        ordem: 0,
      },
    ],
    exclusivo: false,
    precoDesbloqueio: null,
    totalCurtidas: 987,
    totalComentarios: 63,
    curtido: false,
    guardado: true,
    criadoEm: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(), // 4h atrás
  },
  {
    id: 1004,
    autor: {
      id: 5,
      username: 'pedro_viagens',
      nomeExibicao: 'Pedro Viagens',
      avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=pedro&backgroundColor=0a1a0a&radius=50',
      verificado: true,
    },
    legenda: 'Moçambique — o país que roubou o meu coração 🇲🇿 Ilha de Moçambique é Património da Humanidade e poucos angolanos sabem disso. Quem já foi?',
    localizacao: 'Ilha de Moçambique',
    tipo: 'video',
    media: [
      {
        id: 4,
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
        tipo: 'video',
        ordem: 0,
      },
    ],
    exclusivo: false,
    precoDesbloqueio: null,
    totalCurtidas: 2567,
    totalComentarios: 94,
    curtido: false,
    guardado: false,
    criadoEm: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(), // 8h atrás
  },
  {
    id: 1005,
    autor: {
      id: 6,
      username: 'luna_fashion',
      nomeExibicao: 'Luna Fashion',
      avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=luna&backgroundColor=1a001a&radius=50',
      verificado: false,
    },
    legenda: 'Look do dia ✨ Pano africano com toque contemporâneo. A moda africana está a conquistar o mundo e eu não podia estar mais orgulhosa 🌍\n\n#AfroFashion #AngolanDesigner',
    localizacao: 'Talatona, Luanda',
    tipo: 'video',
    media: [
      {
        id: 5,
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
        tipo: 'video',
        ordem: 0,
      },
    ],
    exclusivo: false,
    precoDesbloqueio: null,
    totalCurtidas: 1123,
    totalComentarios: 38,
    curtido: false,
    guardado: false,
    criadoEm: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(), // 12h atrás
  },
  {
    id: 1006,
    autor: {
      id: 2,
      username: 'ana_kriativa',
      nomeExibicao: 'Ana Kriativa',
      avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=ana&backgroundColor=1a1a2e&radius=50',
      verificado: true,
    },
    legenda: '🔒 Conteúdo exclusivo — bastidores completos da sessão e fotos sem edição disponíveis para subscritores. Link na bio.',
    localizacao: null,
    tipo: 'imagem',
    media: [
      {
        id: 6,
        url: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=600&h=600&fit=crop',
        tipo: 'imagem',
        ordem: 0,
      },
    ],
    exclusivo: true,
    precoDesbloqueio: 2500,
    totalCurtidas: 4891,
    totalComentarios: 211,
    curtido: false,
    guardado: false,
    criadoEm: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1 dia atrás
  },
  {
    id: 1007,
    autor: {
      id: 3,
      username: 'marcos_beats',
      nomeExibicao: 'Marcos Beats',
      avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=marcos&backgroundColor=0d0d1a&radius=50',
      verificado: true,
    },
    legenda: 'A cozinha angolana não tem rival 🍽️ Mufete de hoje, cortesia da minha mãe. Alguém consegue adivinhar os ingredientes?',
    localizacao: 'Viana, Luanda',
    tipo: 'imagem',
    media: [
      {
        id: 7,
        url: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=600&h=600&fit=crop',
        tipo: 'imagem',
        ordem: 0,
      },
    ],
    exclusivo: false,
    precoDesbloqueio: null,
    totalCurtidas: 678,
    totalComentarios: 55,
    curtido: true,
    guardado: true,
    criadoEm: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(), // 30h atrás
  },

  // ── Conteúdo bloqueado — só para assinantes (vídeo) ──────────────────────
  {
    id: 1008,
    autor: {
      id: 4,
      username: 'sofia_fitness',
      nomeExibicao: 'Sofia Fitness',
      avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=sofia&backgroundColor=1a0a0a&radius=50',
      verificado: true,
    },
    legenda: '🔒 Treino completo de 45 min — só para assinantes. Plano de nutrição incluído.',
    localizacao: 'Luanda Sport Club',
    tipo: 'video',
    media: [
      {
        id: 8,
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
        tipo: 'video',
        ordem: 0,
      },
    ],
    exclusivo: true,
    precoDesbloqueio: null, // subscrição mensal
    totalCurtidas: 3120,
    totalComentarios: 87,
    curtido: false,
    guardado: false,
    criadoEm: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString(),
  },

  // ── Conteúdo bloqueado — pagamento único (imagem) ────────────────────────
  {
    id: 1009,
    autor: {
      id: 5,
      username: 'pedro_viagens',
      nomeExibicao: 'Pedro Viagens',
      avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=pedro&backgroundColor=0a1a0a&radius=50',
      verificado: true,
    },
    legenda: '📸 Guia completo das melhores praias secretas de Moçambique — 47 fotos em alta resolução.',
    localizacao: 'Pemba, Moçambique',
    tipo: 'imagem',
    media: [
      {
        id: 9,
        url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&h=600&fit=crop',
        tipo: 'imagem',
        ordem: 0,
      },
    ],
    exclusivo: true,
    precoDesbloqueio: 1500,
    totalCurtidas: 1890,
    totalComentarios: 42,
    curtido: false,
    guardado: false,
    criadoEm: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
  },

  // ── Conteúdo bloqueado — pagamento único (vídeo) ─────────────────────────
  {
    id: 1010,
    autor: {
      id: 3,
      username: 'marcos_beats',
      nomeExibicao: 'Marcos Beats',
      avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=marcos&backgroundColor=0d0d1a&radius=50',
      verificado: true,
    },
    legenda: '🎧 Session completa de 1h gravada ao vivo no Black Rose. Stems disponíveis para download.',
    localizacao: 'Estúdio Black Rose, Luanda',
    tipo: 'video',
    media: [
      {
        id: 10,
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        tipo: 'video',
        ordem: 0,
      },
    ],
    exclusivo: true,
    precoDesbloqueio: 3500,
    totalCurtidas: 5230,
    totalComentarios: 198,
    curtido: false,
    guardado: false,
    criadoEm: new Date(Date.now() - 1000 * 60 * 60 * 52).toISOString(),
  },

  // ── Conteúdo bloqueado — só para assinantes (imagem) ────────────────────
  {
    id: 1011,
    autor: {
      id: 2,
      username: 'ana_kriativa',
      nomeExibicao: 'Ana Kriativa',
      avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=ana&backgroundColor=1a1a2e&radius=50',
      verificado: true,
    },
    legenda: '✨ Bastidores da sessão + 30 fotos sem edição. Acesso exclusivo para assinantes do plano mensal.',
    localizacao: null,
    tipo: 'imagem',
    media: [
      {
        id: 11,
        url: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=600&h=600&fit=crop',
        tipo: 'imagem',
        ordem: 0,
      },
    ],
    exclusivo: true,
    precoDesbloqueio: null, // subscrição mensal
    totalCurtidas: 7640,
    totalComentarios: 304,
    curtido: false,
    guardado: false,
    criadoEm: new Date(Date.now() - 1000 * 60 * 60 * 60).toISOString(),
  },
];
