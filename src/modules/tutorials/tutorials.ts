// Tutoriais em vídeo mostrados na tela "Tutoriais".
//
// Os vídeos são gravados pelo script scripts/tutorials/record.mjs e ficam em
// public/tutorials/<id>.webm. Tutorial sem `video` aparece como "Em breve".
// `adminOnly`: só administradores veem (o atendente não tem acesso à tela).

export type TutorialTrackId =
  | "primeiros-passos"
  | "atendimento"
  | "clientes-vendas"
  | "automacao"
  | "gestao";

export interface TutorialTrack {
  id: TutorialTrackId;
  title: string;
  description: string;
}

export interface Tutorial {
  id: string;
  track: TutorialTrackId;
  title: string;
  description: string;
  /** Caminho do vídeo em public/ (ex.: /tutorials/criar-atendente.webm) */
  video?: string;
  /** Duração aproximada, ex.: "1:20" */
  duration?: string;
  /** Tela do sistema que o tutorial ensina */
  path?: string;
  adminOnly?: boolean;
}

export const TUTORIAL_TRACKS: TutorialTrack[] = [
  {
    id: "primeiros-passos",
    title: "Primeiros passos",
    description: "Deixe a conta da sua empresa pronta para atender.",
  },
  {
    id: "atendimento",
    title: "Atendimento no dia a dia",
    description: "O essencial para responder os clientes.",
  },
  {
    id: "clientes-vendas",
    title: "Clientes e vendas",
    description: "Carteira de clientes e funil de vendas.",
  },
  {
    id: "automacao",
    title: "Automação",
    description: "Bots, assistente com IA e campanhas.",
  },
  {
    id: "gestao",
    title: "Gestão",
    description: "Acompanhe a equipe e os resultados.",
  },
];

export const TUTORIALS: Tutorial[] = [
  // Primeiros passos
  {
    id: "conectar-whatsapp-qr",
    track: "primeiros-passos",
    title: "Conectar o WhatsApp por QR Code",
    description: "Ligue o número da empresa lendo o QR Code no celular.",
    path: "/inbox/settings",
    adminOnly: true,
  },
  {
    id: "conectar-whatsapp-oficial",
    track: "primeiros-passos",
    title: "Conectar o WhatsApp oficial (Meta)",
    description: "Use a API oficial do WhatsApp com a sua conta da Meta.",
    path: "/inbox/settings/integrations/meta",
    adminOnly: true,
  },
  {
    id: "criar-departamentos",
    track: "primeiros-passos",
    title: "Criar departamentos",
    description: "Separe os atendimentos por setor, como Vendas e Suporte.",
    path: "/inbox/departments",
    adminOnly: true,
  },
  {
    id: "criar-atendente",
    track: "primeiros-passos",
    title: "Criar uma atendente",
    description:
      "Convide uma pessoa da equipe, escolha o cargo e o setor dela.",
    // #t=1 pula a tela de carregamento do primeiro segundo
    video: "/tutorials/criar-atendente.webm#t=1",
    duration: "0:44",
    path: "/inbox/attendants",
    adminOnly: true,
  },
  {
    id: "automacoes-conversa",
    track: "primeiros-passos",
    title: "Mensagens automáticas de conversa",
    description: "Boas-vindas, ausência e encerramento automático.",
    path: "/inbox/settings/automations/conversations",
    adminOnly: true,
  },

  // Atendimento no dia a dia
  {
    id: "conhecer-atendimentos",
    track: "atendimento",
    title: "Conhecer a tela de atendimentos",
    description: "Filtros, abas e o status de cada conversa.",
    path: "/inbox",
  },
  {
    id: "responder-transferir-finalizar",
    track: "atendimento",
    title: "Responder, transferir e finalizar",
    description: "O caminho completo de uma conversa.",
    path: "/inbox",
  },
  {
    id: "usar-mensagens-rapidas",
    track: "atendimento",
    title: "Usar mensagens rápidas",
    description: "Respostas prontas com poucos cliques.",
    path: "/inbox/quick-messages",
  },
  {
    id: "usar-etiquetas",
    track: "atendimento",
    title: "Usar etiquetas",
    description: "Marque as conversas para encontrá-las depois.",
    path: "/inbox/tags",
  },
  {
    id: "enviar-arquivos",
    track: "atendimento",
    title: "Enviar áudio, imagem e arquivo",
    description: "Mande mais do que texto para o cliente.",
    path: "/inbox",
  },
  {
    id: "chat-interno",
    track: "atendimento",
    title: "Conversar com a equipe",
    description: "Use o chat interno sem sair da Unxet.",
    path: "/inbox/team",
  },

  // Clientes e vendas
  {
    id: "carteira-clientes",
    track: "clientes-vendas",
    title: "Carteira de clientes",
    description: "Cadastre, busque e anote informações dos clientes.",
    path: "/contacts",
    adminOnly: true,
  },
  {
    id: "funil-vendas",
    track: "clientes-vendas",
    title: "Funil de vendas",
    description: "Crie negócios, mova entre etapas e agende tarefas.",
    path: "/inbox/leads",
  },

  // Automação
  {
    id: "criar-bot",
    track: "automacao",
    title: "Criar um bot com menu",
    description: "Monte um menu de opções para os clientes.",
    path: "/inbox/bots",
    adminOnly: true,
  },
  {
    id: "assistente-ia",
    track: "automacao",
    title: "Configurar o assistente com IA",
    description: "Ensine o assistente a responder pela empresa.",
    path: "/inbox/ai-assistant",
    adminOnly: true,
  },
  {
    id: "criar-campanha",
    track: "automacao",
    title: "Criar uma campanha",
    description: "Envie uma mensagem para vários clientes de uma vez.",
    path: "/inbox/campaigns",
  },

  // Gestão
  {
    id: "painel",
    track: "gestao",
    title: "Ler o Painel",
    description: "Veja o que está acontecendo agora no atendimento.",
    path: "/inbox",
    adminOnly: true,
  },
  {
    id: "relatorios",
    track: "gestao",
    title: "Gerar e exportar relatórios",
    description: "Resultados por período, em PDF ou planilha.",
    path: "/inbox/reports",
    adminOnly: true,
  },
];

const WATCHED_KEY = "unxet:tutorials:watched";

export const readWatchedTutorials = (): string[] => {
  try {
    const raw = window.localStorage.getItem(WATCHED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveWatchedTutorials = (ids: string[]) => {
  try {
    window.localStorage.setItem(WATCHED_KEY, JSON.stringify(ids));
  } catch {
    // sem armazenamento: só não lembra na próxima visita
  }
};
