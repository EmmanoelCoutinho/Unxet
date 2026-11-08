
// Tutoriais em vídeo mostrados na tela "Tutoriais".
//
// Os vídeos são gravados pelo script scripts/tutorials/record.mjs e ficam em
// public/tutorials/<id>.mp4. Tutorial sem `video` aparece como "Em breve".
// `adminOnly`: só administradores veem (o atendente não tem acesso à tela).

import { AI_ASSISTANT_ENABLED } from "../../lib/aiAssistantFlag";

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
  /** Caminho do vídeo em public/ (ex.: /tutorials/criar-atendente.mp4) */
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
    video: "/tutorials/conectar-whatsapp-qr.mp4#t=1",
    duration: "0:44",
    path: "/inbox/settings/integrations/meta",
    adminOnly: true,
  },
  {
    id: "conectar-whatsapp-oficial",
    track: "primeiros-passos",
    title: "Conectar o WhatsApp oficial (Meta)",
    description: "Use a API oficial do WhatsApp com a sua conta da Meta.",
    video: "/tutorials/conectar-whatsapp-oficial.mp4#t=1",
    duration: "0:50",
    path: "/inbox/settings/integrations/meta",
    adminOnly: true,
  },
  {
    id: "criar-departamentos",
    track: "primeiros-passos",
    title: "Criar departamentos",
    description: "Separe os atendimentos por setor, como Vendas e Suporte.",
    video: "/tutorials/criar-departamentos.mp4#t=1",
    duration: "1:03",
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
    video: "/tutorials/criar-atendente.mp4#t=1",
    duration: "0:48",
    path: "/inbox/attendants",
    adminOnly: true,
  },  {
    id: "criar-cargos",
    track: "primeiros-passos",
    title: "Criar cargos e permissões",
    description: "Crie cargos como Supervisor e escolha o que cada um pode ver e fazer.",
    video: "/tutorials/criar-cargos.mp4#t=1",
    duration: "1:03",
    path: "/inbox/attendants",
    adminOnly: true,
  },

  {
    id: "automacoes-conversa",
    track: "primeiros-passos",
    title: "Automações de conversa",
    description:
      "Meta de 1ª resposta, volta para a fila, encerramento automático e pesquisa de satisfação.",
    video: "/tutorials/automacoes-conversa.mp4#t=1",
    duration: "0:59",
    path: "/inbox/settings/automations/conversations",
    adminOnly: true,
  },

  // Atendimento no dia a dia
  {
    id: "dia-a-dia-atendente",
    track: "atendimento",
    title: "Um atendimento do início ao fim",
    description:
      "Pegue o cliente da fila, responda, marque com etiqueta e finalize: o caminho de cada conversa.",
    video: "/tutorials/dia-a-dia-atendente.mp4#t=1",
    duration: "0:53",
    path: "/inbox",
  },
  {
    id: "conhecer-atendimentos",
    track: "atendimento",
    title: "Conhecer a tela de atendimentos",
    description: "Filtros, abas e o status de cada conversa.",
    video: "/tutorials/conhecer-atendimentos.mp4#t=1",
    duration: "0:52",
    path: "/inbox",
  },
  {
    id: "transferir-conversa",
    track: "atendimento",
    title: "Transferir uma conversa",
    description: "Passe o cliente para outro setor, com todo o histórico.",
    video: "/tutorials/transferir-conversa.mp4#t=1",
    duration: "0:32",
    path: "/inbox",
  },
  {
    id: "usar-mensagens-rapidas",
    track: "atendimento",
    title: "Usar mensagens rápidas",
    description: "Respostas prontas com poucos cliques.",
    video: "/tutorials/usar-mensagens-rapidas.mp4#t=1",
    duration: "0:51",
    path: "/inbox/quick-messages",
  },
  {
    id: "usar-etiquetas",
    track: "atendimento",
    title: "Usar etiquetas",
    description: "Marque as conversas para encontrá-las depois.",
    video: "/tutorials/usar-etiquetas.mp4#t=1",
    duration: "0:55",
    path: "/inbox/tags",
  },
  {
    id: "enviar-arquivos",
    track: "atendimento",
    title: "Enviar áudio, imagem e arquivo",
    description: "Mande mais do que texto para o cliente.",
    video: "/tutorials/enviar-arquivos.mp4#t=1",
    duration: "0:46",
    path: "/inbox",
  },
  {
    id: "chat-interno",
    track: "atendimento",
    title: "Conversar com a equipe",
    description: "Use o chat interno sem sair da Unxet.",
    video: "/tutorials/chat-interno.mp4#t=1",
    duration: "0:37",
    path: "/inbox/team",
  },

  // Clientes e vendas
  {
    id: "carteira-clientes",
    track: "clientes-vendas",
    title: "Carteira de clientes",
    description: "Cadastre, busque e anote informações dos clientes.",
    video: "/tutorials/carteira-clientes.mp4#t=1",
    duration: "1:29",
    path: "/contacts",
    adminOnly: true,
  },
  {
    id: "funil-vendas",
    track: "clientes-vendas",
    title: "Funil de vendas",
    description: "Crie negócios, mova entre etapas e agende tarefas.",
    video: "/tutorials/funil-vendas.mp4#t=1",
    duration: "1:28",
    path: "/inbox/leads",
  },

  // Automação
  {
    id: "criar-bot",
    track: "automacao",
    title: "Criar um bot com menu",
    description: "Monte um menu de opções para os clientes.",
    video: "/tutorials/criar-bot.mp4#t=1",
    duration: "1:38",
    path: "/inbox/bots",
    adminOnly: true,
  },
  // Some enquanto o assistente com IA estiver desligado no app
  ...(AI_ASSISTANT_ENABLED
    ? [
        {
          id: "assistente-ia",
          track: "automacao" as const,
          title: "Configurar o assistente com IA",
          description: "Ensine o assistente a responder pela empresa.",
          video: "/tutorials/assistente-ia.mp4#t=1",
          duration: "1:21",
          path: "/inbox/ai-assistant",
          adminOnly: true,
        },
      ]
    : []),
  {
    id: "criar-campanha",
    track: "automacao",
    title: "Criar uma campanha",
    description: "Envie uma mensagem para vários clientes de uma vez.",
    video: "/tutorials/criar-campanha.mp4#t=1",
    duration: "1:22",
    path: "/inbox/campaigns",
  },  {
    id: "modelos-meta",
    track: "automacao",
    title: "Usar modelos da Meta",
    description: "No WhatsApp oficial: crie o modelo, aguarde a aprovação e use na campanha.",
    video: "/tutorials/modelos-meta.mp4#t=1",
    duration: "1:41",
    path: "/inbox/campaigns/templates",
    adminOnly: true,
  },


  // Gestão
  {
    id: "painel",
    track: "gestao",
    title: "Ler o Painel",
    description: "Veja o que está acontecendo agora no atendimento.",
    video: "/tutorials/painel.mp4#t=1",
    duration: "0:53",
    path: "/inbox",
    adminOnly: true,
  },
  {
    id: "relatorios",
    track: "gestao",
    title: "Gerar e exportar relatórios",
    description: "Resultados por período, em PDF ou planilha.",
    video: "/tutorials/relatorios.mp4#t=1",
    duration: "0:52",
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

/** Marca o tutorial como assistido neste navegador */
export const markTutorialWatched = (id: string) => {
  const watched = readWatchedTutorials();
  if (!watched.includes(id)) saveWatchedTutorials([...watched, id]);
};
