import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

/**
 * O bucket whatsapp-media é privado: as URLs gravadas no banco (formato
 * público) não abrem sozinhas. Este módulo troca essas URLs por links
 * assinados e temporários emitidos pela edge function media-urls, que só
 * assina arquivos de mensagens/contatos que o usuário pode ver.
 *
 * Pedidos de vários componentes são agrupados em lote e o resultado fica em
 * cache até perto de expirar.
 */

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const PRIVATE_MEDIA_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/whatsapp-media/`;

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 30;
// Renova o link alguns minutos antes de expirar
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

type CacheEntry = { signedUrl: string; expiresAt: number };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string | null>>();
const queue = new Map<string, (value: string | null) => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export const isPrivateMediaUrl = (url: unknown): url is string =>
  typeof url === "string" && !!SUPABASE_URL && url.startsWith(PRIVATE_MEDIA_PREFIX);

const getFreshCache = (url: string) => {
  const entry = cache.get(url);
  if (entry && entry.expiresAt - REFRESH_MARGIN_MS > Date.now()) return entry;
  return null;
};

const flush = async () => {
  flushTimer = null;
  const batch = Array.from(queue.entries()).slice(0, BATCH_SIZE);
  batch.forEach(([url]) => queue.delete(url));
  if (queue.size) flushTimer = setTimeout(flush, 0);
  if (!batch.length) return;

  const urls = batch.map(([url]) => url);
  let signed: Record<string, string> = {};
  let expiresInSec = 3600;

  try {
    const { data, error } = await supabase.functions.invoke("media-urls", {
      body: { urls },
    });
    if (error) throw error;
    signed = (data?.urls ?? {}) as Record<string, string>;
    if (typeof data?.expiresIn === "number") expiresInSec = data.expiresIn;
  } catch (error) {
    console.error("Erro ao obter links da mídia:", error);
  }

  const expiresAt = Date.now() + expiresInSec * 1000;
  for (const [url, resolve] of batch) {
    const signedUrl = signed[url] ?? null;
    // Só sucesso vai para o cache: uma mensagem recém-enviada pode ainda não
    // estar no banco e ser liberada na próxima tentativa
    if (signedUrl) cache.set(url, { signedUrl, expiresAt });
    inflight.delete(url);
    resolve(signedUrl);
  }
};

/** Link utilizável para exibir a mídia (ou null se o acesso não for liberado). */
export const resolveMediaUrl = (url: string): Promise<string | null> => {
  if (!isPrivateMediaUrl(url)) return Promise.resolve(url);

  const cached = getFreshCache(url);
  if (cached) return Promise.resolve(cached.signedUrl);

  const pending = inflight.get(url);
  if (pending) return pending;

  const promise = new Promise<string | null>((resolve) => {
    queue.set(url, resolve);
    if (!flushTimer) flushTimer = setTimeout(flush, BATCH_DELAY_MS);
  });
  inflight.set(url, promise);
  return promise;
};

/**
 * Hook: devolve a URL pronta para <img>/<audio>/<a>. Para mídia privada,
 * retorna undefined enquanto o link assinado é obtido e o renova antes de
 * expirar.
 */
export const useMediaUrl = (url: string | null | undefined) => {
  const initial = () => {
    if (!url) return undefined;
    if (!isPrivateMediaUrl(url)) return url;
    return getFreshCache(url)?.signedUrl;
  };

  const [resolved, setResolved] = useState<string | undefined>(initial);

  useEffect(() => {
    if (!url) {
      setResolved(undefined);
      return;
    }
    if (!isPrivateMediaUrl(url)) {
      setResolved(url);
      return;
    }

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      const signedUrl = await resolveMediaUrl(url);
      if (cancelled) return;
      setResolved(signedUrl ?? undefined);

      const entry = cache.get(url);
      if (entry) {
        const delay = Math.max(entry.expiresAt - REFRESH_MARGIN_MS - Date.now(), 30_000);
        refreshTimer = setTimeout(load, delay);
      }
    };

    setResolved(getFreshCache(url)?.signedUrl);
    load();

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [url]);

  return resolved;
};
