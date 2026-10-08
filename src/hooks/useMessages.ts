import { useCallback, useEffect, useRef, useState } from "react";
import type { Message as UiMessage } from "../types";
import { supabase } from "../lib/supabaseClient";

export const DELETED_MESSAGE_TEXT = "🚫 Mensagem apagada";

type DbMessage = {
  id: string;
  conversation_id: string;
  direction?: "inbound" | "outbound" | string | null;
  text?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
  sender?: string | null;
  type?: string | null;
  payload?: any;
  media_url?: string | null;
  image_url?: string | null;
  media_mime_type?: string | null;
  caption?: string | null;
  filename?: string | null;
  transcript_status?: "PENDING" | "PROCESSING" | "DONE" | "FAILED" | null;
  transcript_text?: string | null;
  deleted_at?: string | null;
  deleted_for_everyone?: boolean | null;
  delivered_at?: string | null;
  read_at?: string | null;
};

const safeParsePayload = (raw: any) => {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw ?? {};
};

const getMediaData = (payload: any) => {
  const baseCandidates = [
    payload,
    payload?.message,
    payload?.messages?.[0],
    payload?.data,
    payload?.value,
    payload?.entry?.[0]?.changes?.[0]?.value,
  ].filter(Boolean);

  const candidates: any[] = [];
  baseCandidates.forEach((c) => {
    candidates.push(c);
    if (c?.message) candidates.push(c.message);
    if (Array.isArray(c?.messages) && c.messages.length > 0) {
      candidates.push(c.messages[0]);
    }
  });

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.image) return { type: "image", data: candidate.image };
    if (candidate.audio) return { type: "audio", data: candidate.audio };
    if (candidate.sticker) return { type: "sticker", data: candidate.sticker };
    if (candidate.video) return { type: "video", data: candidate.video };
    if (candidate.document)
      return { type: "document", data: candidate.document };
  }
  return { type: undefined, data: undefined };
};

const normalizeTranscriptStatus = (
  value: unknown,
): "PENDING" | "PROCESSING" | "DONE" | "FAILED" | undefined => {
  if (typeof value !== "string") return undefined;
  if (
    value === "PENDING" ||
    value === "PROCESSING" ||
    value === "DONE" ||
    value === "FAILED"
  ) {
    return value;
  }
  return undefined;
};

export const mapDbMessage = (row: DbMessage): UiMessage => {
  const payload = safeParsePayload(row?.payload);
  const mediaInfo = getMediaData(payload);

  const type = row?.type ?? mediaInfo.type ?? (payload as any)?.type;

  const waMessage = Array.isArray(payload?.messages)
    ? payload.messages[0]
    : undefined;

  const mediaUrl =
    row.image_url ??
    row.media_url ??
    mediaInfo.data?.url ??
    waMessage?.image?.url ??
    waMessage?.audio?.url ??
    waMessage?.video?.url ??
    waMessage?.document?.url ??
    undefined;

  const mediaMimeType =
    row.media_mime_type ?? mediaInfo.data?.mime_type ?? undefined;

  const caption =
    waMessage?.image?.caption ??
    waMessage?.document?.caption ??
    (mediaInfo.data as any)?.caption ??
    row?.caption ??
    null;

  const filename =
    row.filename ??
    waMessage?.document?.filename ??
    (mediaInfo.data as any)?.filename ??
    (mediaInfo.data as any)?.name ??
    (payload as any)?.document?.filename ??
    undefined;

  const fileSize =
    waMessage?.document?.file_size ??
    (mediaInfo.data as any)?.file_size ??
    (payload as any)?.document?.file_size ??
    undefined;

  const direction = row.direction as "inbound" | "outbound" | undefined;
  const transcriptStatus = normalizeTranscriptStatus(
    row.transcript_status ??
      payload?.transcript_status ??
      payload?.transcript?.status,
  );

  const transcriptText =
    row.transcript_text ??
    payload?.transcript_text ??
    payload?.transcript?.text ??
    payload?.transcription?.text ??
    payload?.transcription ??
    payload?.deepgram?.transcript ??
    undefined;

  // Exclusão lógica (edge function delete-message): mantém a linha e oculta o conteúdo
  const isDeleted = !!row.deleted_at;
  const textContent = isDeleted ? DELETED_MESSAGE_TEXT : (row.text ?? caption ?? "");

  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction,
    author: row.direction === "inbound" ? "cliente" : "atendente",
    text: textContent,
    type: isDeleted ? "text" : type,
    mediaUrl: isDeleted ? undefined : (mediaUrl ?? undefined),
    mediaMimeType: isDeleted ? undefined : (mediaMimeType ?? undefined),
    filename: isDeleted ? undefined : (filename ?? undefined),
    fileSize: isDeleted ? undefined : (fileSize ?? undefined),
    transcriptStatus: isDeleted ? undefined : (transcriptStatus ?? undefined),
    transcriptText: isDeleted ? undefined : (typeof transcriptText === "string" ? transcriptText : undefined),
    payload,
    deletedAt: row.deleted_at ?? undefined,
    deletedForEveryone: row.deleted_for_everyone ?? undefined,
    deliveryStatus:
      row.direction === "outbound"
        ? row.read_at
          ? "read"
          : row.delivered_at
            ? "delivered"
            : "sent"
        : undefined,
    createdAt: row.sent_at ?? row.created_at ?? new Date().toISOString(),
  };
};

const messagesCache = new Map<string, UiMessage[]>();

export function isLocalOptimisticId(id: any) {
  return typeof id === "string" && id.startsWith("local-");
}

const toTime = (iso: string) => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

// Mensagens locais (ainda não confirmadas) ficam sempre no fim, na ordem em que
// foram enviadas: o createdAt delas vem do relógio do navegador e não é
// comparável com o sent_at gravado pelo servidor.
export function compareMessages(a: UiMessage, b: UiMessage) {
  const aLocal = isLocalOptimisticId(a.id);
  const bLocal = isLocalOptimisticId(b.id);
  if (aLocal !== bLocal) return aLocal ? 1 : -1;
  if (aLocal && bLocal) return 0; // sort estável preserva a ordem de envio
  return toTime(a.createdAt) - toTime(b.createdAt);
}

export const sortMessages = (list: UiMessage[]) =>
  [...list].sort(compareMessages);

const normalizeText = (text?: string | null) => (text ?? "").trim();

// Uma mensagem persistida só corresponde a uma otimista se for do mesmo tipo e
// tiver o mesmo conteúdo. Casar só pelo tipo fazia, com "oi" e "tudo bem?" na
// fila, o "oi" confirmado sobrescrever o card do "tudo bem?".
function isSameOutgoingMessage(local: UiMessage, persisted: UiMessage) {
  if ((local.type ?? "text") !== (persisted.type ?? "text")) return false;
  if (normalizeText(local.text) === normalizeText(persisted.text)) return true;
  return (
    !!local.mediaUrl &&
    !!persisted.mediaUrl &&
    local.mediaUrl === persisted.mediaUrl
  );
}

function mergeDbWithLocalOptimistics(prev: UiMessage[], db: UiMessage[]) {
  const locals = prev.filter((m) => isLocalOptimisticId(m.id));
  if (!locals.length) return sortMessages(db);

  const merged: UiMessage[] = [...db];
  // Cada mensagem do banco absorve no máximo uma otimista (ex.: dois "oi" seguidos)
  const claimedDbIds = new Set<string>();

  for (const lm of locals) {
    const lmAt = toTime(lm.createdAt);
    const match = db.find((m) => {
      if (m.author !== "atendente") return false;
      if (claimedDbIds.has(m.id)) return false;
      const closeInTime = Math.abs(toTime(m.createdAt) - lmAt) <= 60_000;
      return closeInTime && isSameOutgoingMessage(lm, m);
    });

    if (match) claimedDbIds.add(match.id);
    else merged.push(lm);
  }

  return sortMessages(merged);
}

function replaceLocalOptimisticWithPersisted(
  current: UiMessage[],
  persisted: UiMessage,
) {
  if (persisted.author !== "atendente") return null;

  const locals = current.filter((m) => isLocalOptimisticId(m.id));
  // A fila envia em ordem, então a mais antiga que casa é a correta.
  let target = locals.find((m) => isSameOutgoingMessage(m, persisted));

  // Mídia pode voltar com URL/legenda diferentes do otimista; nesse caso aceita
  // a mais antiga do mesmo tipo. Texto nunca usa esse fallback.
  if (!target && (persisted.type ?? "text") !== "text") {
    target = locals.find(
      (m) => (m.type ?? "text") === (persisted.type ?? "text"),
    );
  }

  if (!target) return null;

  return sortMessages(current.map((m) => (m === target ? persisted : m)));
}

export function useMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<any>(null);

  const didInitialLoadRef = useRef(false);
  const activeConversationIdRef = useRef<string | null>(conversationId);
  const fetchMessagesRef = useRef<
    (opts?: { reason?: "initial" | "refetch" }) => Promise<void>
  >(() => Promise.resolve());

  useEffect(() => {
    activeConversationIdRef.current = conversationId;

    if (!conversationId) {
      setMessages([]);
      setLoading(false);
      setRefreshing(false);
      setError(null);
      didInitialLoadRef.current = true;
      return;
    }

    const cached = messagesCache.get(conversationId);
    if (cached && cached.length) {
      setMessages(cached);
      setLoading(false);
    } else {
      setMessages([]);
      setLoading(true);
    }

    setError(null);
    didInitialLoadRef.current = false;
  }, [conversationId]);

  const fetchMessages = useCallback(
    async (opts?: { reason?: "initial" | "refetch" }) => {
      if (!conversationId) {
        setMessages([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const reason =
        opts?.reason ?? (didInitialLoadRef.current ? "refetch" : "initial");

      const hasCacheData = messagesCache.get(conversationId)?.length
        ? true
        : false;

      const hasUiData = messages.length > 0;

      const shouldHardLoad =
        reason === "initial" &&
        !hasCacheData &&
        !hasUiData &&
        !didInitialLoadRef.current;

      if (shouldHardLoad) setLoading(true);
      else setRefreshing(true);

      setError(null);

      const { data, error } = await supabase
        .from("messages")
        .select(
          `
            id,
            conversation_id,
            direction,
            text,
            sent_at,
            created_at,
            sender,
            type,
            payload,
            image_url,
            media_url,
            media_mime_type,
            filename,
            transcript_status,
            transcript_text,
            deleted_at,
            deleted_for_everyone,
            delivered_at,
            read_at
          `,
        )
        .eq("conversation_id", conversationId)
        .order("sent_at", { ascending: true });

      if (error) {
        setError(error);
        setLoading(false);
        setRefreshing(false);
        didInitialLoadRef.current = true;
        return;
      }

      const mapped = (data ?? []).map((row) => mapDbMessage(row as DbMessage));

      setMessages((prev) => {
        const next = mergeDbWithLocalOptimistics(prev, mapped);
        messagesCache.set(conversationId, next);
        return next;
      });

      setLoading(false);
      setRefreshing(false);
      didInitialLoadRef.current = true;
    },
    [conversationId, messages.length],
  );

  useEffect(() => {
    fetchMessagesRef.current = fetchMessages;
  }, [fetchMessages]);

  useEffect(() => {
    if (!conversationId) return;

    const cached = messagesCache.get(conversationId);
    const fn = fetchMessagesRef.current;
    if (cached && cached.length) {
      fn({ reason: "refetch" });
      return;
    }

    fn({ reason: "initial" });
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`conversation-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMsg = mapDbMessage(payload.new as DbMessage);

          setMessages((current) => {
            const existingIdx = current.findIndex((m) => m.id === newMsg.id);
            if (existingIdx >= 0) {
              const existing = current[existingIdx];
              const merged: UiMessage = {
                ...newMsg,
                filename: newMsg.filename ?? existing.filename,
                fileSize: newMsg.fileSize ?? existing.fileSize,
                text:
                  newMsg.text ||
                  (existing.type === "document" && existing.filename
                    ? existing.filename
                    : existing.text),
              };
              const next = current.map((m, i) =>
                i === existingIdx ? merged : m,
              );
              messagesCache.set(conversationId, next);
              return next;
            }

            const replaced = replaceLocalOptimisticWithPersisted(
              current,
              newMsg,
            );
            if (replaced) {
              messagesCache.set(conversationId, replaced);
              return replaced;
            }

            const next = sortMessages([...current, newMsg]);

            messagesCache.set(conversationId, next);
            return next;
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const updatedMsg = mapDbMessage(payload.new as DbMessage);

          setMessages((current) => {
            const existingIdx = current.findIndex((m) => m.id === updatedMsg.id);
            if (existingIdx < 0) return current;

            const existing = current[existingIdx];
            const merged: UiMessage = {
              ...existing,
              ...updatedMsg,
              filename: updatedMsg.filename ?? existing.filename,
              fileSize: updatedMsg.fileSize ?? existing.fileSize,
              mediaUrl: updatedMsg.mediaUrl ?? existing.mediaUrl,
              mediaMimeType: updatedMsg.mediaMimeType ?? existing.mediaMimeType,
              text: updatedMsg.text ?? existing.text,
              type: updatedMsg.type ?? existing.type,
            };

            const next = current.map((m, i) => (i === existingIdx ? merged : m));
            messagesCache.set(conversationId, next);
            return next;
          });
        },
      )
      // 🔥 ADICIONADO: Captura o evento de remoção física da linha (DELETE) no Supabase
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const deletedId = payload.old?.id;
          if (!deletedId) return;

          setMessages((current) => {
            // Remove a mensagem diretamente do estado visual ou transforma em um placeholder "apagada"
            const next = current.filter((m) => m.id !== deletedId);
            messagesCache.set(conversationId, next);
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  const setMessagesSafe = useCallback(
    (updater: UiMessage[] | ((prev: UiMessage[]) => UiMessage[])) => {
      setMessages((prev) => {
        const next =
          typeof updater === "function" ? (updater as any)(prev) : updater;
        if (conversationId) messagesCache.set(conversationId, next);
        return next;
      });
    },
    [conversationId],
  );

  return {
    messages,
    loading,
    refreshing,
    error,
    refetch: () => fetchMessages({ reason: "refetch" }),
    setMessages: setMessagesSafe,
  };
}