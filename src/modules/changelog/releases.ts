// Novidades da Unxet mostradas no sino do topo.
//
// Cada PR para a develop adiciona o que mudou em NEXT_RELEASE (a próxima
// versão, ainda em teste). No lançamento, `npm run release` move tudo para
// uma entrada nova NO TOPO de RELEASE_ENTRIES, com a data do dia.
// O número da versão é calculado sozinho:
// - só correções ("fixed"): sobe o último número (2.10.0 -> 2.10.1)
// - tem novidade ou melhoria: sobe o do meio (2.10.1 -> 2.11.0)
// - major: true (muda o jeito de usar o sistema): sobe o primeiro (-> 3.0.0)
// Escreva para quem usa o sistema (sem termos técnicos) e marque com
// adminOnly o que só administradores enxergam.

export type ChangeKind = "new" | "improved" | "fixed";

export interface ReleaseChange {
  kind: ChangeKind;
  text: string;
  adminOnly?: boolean;
}

export interface ReleaseEntry {
  /** AAAA-MM-DD */
  date: string;
  /** Versão grande, que muda o jeito de usar o sistema */
  major?: boolean;
  changes: ReleaseChange[];
}

export interface Release extends ReleaseEntry {
  version: string;
}

/**
 * Versão estimada da Unxet antes de existir esta lista (02/11/2026):
 * 1.0 em fev/2026 (atendentes, setores e painel), 2.0 na reformulação de
 * 06/10/2026 e uma versão nova a cada dia com entrega até 24/10.
 */
export const BASE_VERSION = "2.9.0";

/** Calcula a versão de cada entrada (mais nova primeiro) a partir da base. */
export function computeReleases(
  entries: ReleaseEntry[],
  baseVersion: string,
): Release[] {
  let [major, minor, patch] = baseVersion.split(".").map(Number);
  const oldestFirst = [...entries].reverse().map((entry) => {
    if (entry.major) {
      major += 1;
      minor = 0;
      patch = 0;
    } else if (entry.changes.some((c) => c.kind !== "fixed")) {
      minor += 1;
      patch = 0;
    } else {
      patch += 1;
    }
    return { ...entry, version: `${major}.${minor}.${patch}` };
  });
  return oldestFirst.reverse();
}

export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  new: "Novidades",
  improved: "Melhorias",
  fixed: "Correções",
};

export const CHANGE_KIND_ORDER: ChangeKind[] = ["new", "improved", "fixed"];

/**
 * Próxima versão, em teste na develop. Só aparece no sino fora da produção
 * e precisa estar vazia na main (o CI confere nos PRs para a main).
 * Para versão grande, rode `npm run release -- --major` no lançamento.
 */
// prettier-ignore
export const NEXT_RELEASE: ReleaseChange[] = [
  {
    kind: "new",
    text: "Tutoriais: vídeos curtos que mostram, passo a passo, como usar a Unxet. Fica no rodapé do menu lateral. O primeiro ensina a criar uma atendente e também abre pelo botão Ver tutorial, na tela Atendentes. Novos vídeos chegam aos poucos.",
  },
  {
    kind: "new",
    text: "Modo escuro: no menu do seu perfil (canto superior direito), escolha entre tema Claro, Escuro ou Automático, que acompanha o modo do celular ou do computador.",
  },
  {
    kind: "improved",
    text: "Conversas mais confortáveis de ler: os balões de mensagem ficaram mais largos no computador, a janela flutuante de conversa ficou maior e o cabeçalho dela foi reorganizado.",
  },
  {
    kind: "improved",
    text: "O campo de mensagem cresce conforme você digita, sem mostrar a barra de rolagem logo na segunda linha. As barras de rolagem do sistema também ficaram mais finas e discretas.",
  },
  {
    kind: "improved",
    text: "As janelas do sistema agora fecham pelo X no canto superior, no lugar do botão Fechar.",
  },
  {
    kind: "improved",
    text: "Funil de vendas: clique e arraste o fundo do quadro para ver as outras etapas para os lados.",
  },
];

const RELEASE_ENTRIES: ReleaseEntry[] = [
  {
    date: "2026-11-04",
    changes: [
      {
        kind: "new",
        text: "Página de status: em status.unxet.com.br você confere se a Unxet está funcionando normalmente, parte por parte. O link fica na tela de login e no rodapé do seu perfil, e a página abre mesmo quando o sistema está fora do ar.",
      },
    ],
  },
  {
    date: "2026-11-03",
    changes: [
      {
        kind: "fixed",
        text: "As anotações na Carteira de clientes voltaram a funcionar: dá para escrever, ver e apagar notas sobre cada cliente.",
        adminOnly: true,
      },
    ],
  },
  {
    date: "2026-11-02",
    changes: [
      {
        kind: "new",
        text: "Campanhas: envio em massa e programado no mesmo lugar, em etapas (mensagem, destinatários, envio e revisão), com o resultado de cada envio e reenvio para quem não recebeu.",
      },
      {
        kind: "new",
        text: "Funil de vendas: acompanhe as negociações em colunas, com tarefas, lembretes e mensagem agendada para o cliente.",
      },
      {
        kind: "new",
        text: "Mensagens agendadas na Carteira de clientes: envie uma vez ou repita todo dia, toda semana ou todo mês.",
        adminOnly: true,
      },
      {
        kind: "new",
        text: "Mensagens rápidas pelo atalho: digite / no campo de mensagem para buscar e inserir uma resposta pronta.",
      },
      {
        kind: "new",
        text: "Instagram e Facebook Messenger: conecte as contas em Integrações e atenda tudo pela tela de Atendimentos.",
        adminOnly: true,
      },
      {
        kind: "new",
        text: "Editor de fluxos do bot novo: mapa do fluxo, edição por etapa e prévia de como a conversa aparece no celular.",
        adminOnly: true,
      },
      {
        kind: "improved",
        text: "Menu lateral organizado em Atendimento, Vendas e marketing e Gestão.",
      },
      {
        kind: "improved",
        text: "Nome da empresa em destaque no topo da tela.",
      },
      {
        kind: "improved",
        text: "Mais segurança: ao entrar em outro aparelho, a sessão anterior é encerrada.",
      },
      {
        kind: "improved",
        text: "Integrações mostram o nome, a foto e o @ das contas do Instagram e do Facebook, com botão para desconectar.",
        adminOnly: true,
      },
      {
        kind: "improved",
        text: "Links para os Termos de Uso e a Política de Privacidade.",
      },
      {
        kind: "fixed",
        text: "Mensagens enviadas pelo Instagram e pelo Messenger não aparecem mais duplicadas.",
      },
      {
        kind: "fixed",
        text: "Conversas do Instagram e do Messenger em atendimento não voltam mais para \"Na fila\" a cada mensagem do cliente.",
      },
      {
        kind: "fixed",
        text: "Foto do cliente no WhatsApp atualizada: quando o cliente troca ou tira a foto, o Unxet acompanha a partir da próxima mensagem dele.",
      },
      {
        kind: "fixed",
        text: "Foto do cliente que não carregava agora é atualizada, e as iniciais aparecem no lugar enquanto isso.",
      },
      {
        kind: "fixed",
        text: "A Carteira de clientes não fica mais vazia em empresas com muitos contatos.",
        adminOnly: true,
      },
      {
        kind: "fixed",
        text: "A janela \"Meu perfil\" abre por cima do menu lateral.",
      },
    ],
  },
];

export const RELEASES = computeReleases(RELEASE_ENTRIES, BASE_VERSION);

export const CURRENT_RELEASE = RELEASES[0];

/** Como a próxima versão vai ficar (número calculado, sem data) */
export function previewNextRelease(
  next: ReleaseChange[],
  entries: ReleaseEntry[] = RELEASE_ENTRIES,
  baseVersion: string = BASE_VERSION,
): Omit<Release, "date"> | null {
  if (next.length === 0) return null;
  const [upcoming] = computeReleases(
    [{ date: "", changes: next }, ...entries],
    baseVersion,
  );
  return { version: upcoming.version, changes: upcoming.changes };
}

export const UPCOMING_RELEASE = previewNextRelease(NEXT_RELEASE);

/** "2026-11-02" -> "02/11/2026" sem passar pelo fuso horário */
export function formatReleaseDate(date: string) {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}
