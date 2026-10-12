import type {
  InternalMessage,
  InternalMessagesPage,
} from "../types/internalChat";

const toTime = (iso: string) => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

const isLocal = (message: InternalMessage) =>
  !!message.pending || !!message.failed;

// Mensagens ainda não confirmadas ficam sempre no fim, na ordem de envio: o
// horário delas vem do relógio do navegador e não é comparável com o do servidor.
export function compareInternalMessages(a: InternalMessage, b: InternalMessage) {
  const aLocal = isLocal(a);
  const bLocal = isLocal(b);
  if (aLocal !== bLocal) return aLocal ? 1 : -1;
  if (aLocal && bLocal) return 0; // sort estável preserva a ordem de envio
  return toTime(a.createdAt) - toTime(b.createdAt) || a.id.localeCompare(b.id);
}

export const sortInternalMessages = (list: InternalMessage[]) =>
  [...list].sort(compareInternalMessages);

/** Insere a mensagem ou substitui a que tem o mesmo id (ex.: confirmação do envio). */
export function upsertInternalMessage(
  list: InternalMessage[],
  message: InternalMessage,
) {
  const exists = list.some((m) => m.id === message.id);
  return sortInternalMessages(
    exists
      ? list.map((m) => (m.id === message.id ? message : m))
      : [...list, message],
  );
}

/**
 * Junta a página mais recente vinda do banco com o que já estava na tela:
 * mantém envios ainda não confirmados e as páginas antigas já carregadas.
 */
export function mergeLatestPage(
  prev: InternalMessagesPage | undefined,
  page: InternalMessagesPage,
): InternalMessagesPage {
  if (!prev) return page;

  const pageIds = new Set(page.messages.map((m) => m.id));
  const locals = prev.messages.filter((m) => isLocal(m) && !pageIds.has(m.id));
  const confirmed = prev.messages.filter((m) => !isLocal(m));

  // Sem nenhuma mensagem em comum pode haver um buraco entre o que estava na
  // tela e a página nova: nesse caso vale só a página nova.
  const overlaps = confirmed.some((m) => pageIds.has(m.id));
  const older =
    page.hasMore && overlaps && page.messages.length
      ? confirmed.filter(
          (m) =>
            !pageIds.has(m.id) &&
            toTime(m.createdAt) <= toTime(page.messages[0].createdAt),
        )
      : [];

  return {
    messages: sortInternalMessages([...older, ...page.messages, ...locals]),
    hasMore: older.length ? prev.hasMore : page.hasMore,
  };
}
