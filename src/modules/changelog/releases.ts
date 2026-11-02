// Novidades da Unxet mostradas no sino do topo.
//
// Ao publicar uma atualização, adicione uma entrada NO TOPO de
// RELEASE_ENTRIES. O número da versão é calculado sozinho:
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

const RELEASE_ENTRIES: ReleaseEntry[] = [
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

/** "2026-11-02" -> "02/11/2026" sem passar pelo fuso horário */
export function formatReleaseDate(date: string) {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}
