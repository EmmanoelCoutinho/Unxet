import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BellIcon, RocketIcon, SparklesIcon, type LucideIcon } from "lucide-react";
import { releaseNotice } from "../changelog/releases";
import { IS_PRODUCTION } from "../../lib/environment";
import { useNotifications } from "./useNotifications";

// Tela das novidades (só abre pelo aviso do sino)
export const RELEASE_NOTES_PATH = "/inbox/novidades";

const seenKey = (userId: string) => `unxet:changelog-seen:${userId}`;

const readSeen = (userId: string) => {
  try {
    return window.localStorage.getItem(seenKey(userId));
  } catch {
    return null;
  }
};

const ICONS: Record<string, LucideIcon> = {
  release: RocketIcon,
  ai_usage_warn_80: SparklesIcon,
  ai_usage_exhausted: SparklesIcon,
};

/** "há 5 min", "há 2 h", "ontem", "03/11" */
const timeAgo = (iso: string | null, now = Date.now()) => {
  if (!iso) return "";
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  const minutes = Math.floor((now - date.getTime()) / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  if (hours < 48) return "ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

type BellItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  at: string | null;
  unread: boolean;
};

/**
 * Sino do topo: avisos do sistema para a pessoa (limite da IA, sistema
 * atualizado...). Cada aviso leva para a tela do assunto. Chacoalha quando
 * chega algo novo.
 */
export const NotificationBell = ({ userId }: { userId?: string }) => {
  const navigate = useNavigate();
  const { items, markRead } = useNotifications(userId);
  const [open, setOpen] = useState(false);
  const [seenRelease, setSeenRelease] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [shaking, setShaking] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const lastUnread = useRef(0);

  const notice = useMemo(() => releaseNotice(undefined, undefined, IS_PRODUCTION), []);

  useEffect(() => {
    if (!userId) return;
    setSeenRelease(readSeen(userId));
    setLoaded(true);
  }, [userId]);

  const list: BellItem[] = useMemo(() => {
    const releaseItem: BellItem = {
      id: "release",
      kind: "release",
      title: notice.title,
      body: notice.body,
      url: RELEASE_NOTES_PATH,
      at: notice.date,
      unread: loaded && seenRelease !== notice.key,
    };
    const fromDb: BellItem[] = items.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      url: n.url,
      at: n.created_at,
      unread: !n.read_at,
    }));
    // Não lidos primeiro, depois do mais novo para o mais antigo
    return [releaseItem, ...fromDb].sort(
      (a, b) =>
        Number(b.unread) - Number(a.unread) ||
        new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime(),
    );
  }, [items, notice, loaded, seenRelease]);

  const unreadCount = list.filter((i) => i.unread).length;

  // Chacoalha ao carregar com algo novo e quando chega aviso novo
  useEffect(() => {
    if (unreadCount > lastUnread.current) {
      setShaking(true);
      const timer = window.setTimeout(() => setShaking(false), 1000);
      lastUnread.current = unreadCount;
      return () => window.clearTimeout(timer);
    }
    lastUnread.current = unreadCount;
  }, [unreadCount]);

  const markReleaseSeen = () => {
    if (!userId) return;
    setSeenRelease(notice.key);
    try {
      window.localStorage.setItem(seenKey(userId), notice.key);
    } catch {
      // Sem armazenamento o aviso volta no próximo carregamento
    }
  };

  const openItem = (item: BellItem) => {
    if (item.kind === "release") markReleaseSeen();
    else if (item.unread) void markRead([item.id]);
    setOpen(false);
    if (item.url) navigate(item.url);
  };

  const markAll = () => {
    markReleaseSeen();
    void markRead(items.filter((n) => !n.read_at).map((n) => n.id));
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && (panelRef.current?.contains(target) || buttonRef.current?.contains(target))) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = unreadCount > 0 ? `Notificações (${unreadCount} novas)` : "Notificações";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0A84FF] focus:ring-offset-2"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
      >
        <BellIcon className={`h-5 w-5 origin-top ${shaking ? "animate-bell-shake motion-reduce:animate-none" : ""}`} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Fica sempre montado para animar a abertura e o fechamento */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Notificações"
        aria-hidden={!open}
        className={`absolute right-0 top-full z-50 mt-2 flex max-h-[min(32rem,calc(100vh-6rem))] w-96 max-w-[calc(100vw-1.5rem)] origin-top-right flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg transition-[opacity,transform,visibility] duration-150 ease-out motion-reduce:transition-none ${
          open
            ? "visible translate-y-0 scale-100 opacity-100"
            : "pointer-events-none invisible -translate-y-1 scale-95 opacity-0"
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3">
          <span className="font-medium text-gray-900">Notificações</span>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={markAll}
              className="text-xs font-medium text-[#0A84FF] hover:underline"
            >
              Marcar todas como lidas
            </button>
          ) : null}
        </div>
        <ul className="flex-1 divide-y divide-gray-100 overflow-y-auto overscroll-contain">
          {list.map((item) => {
            const Icon = ICONS[item.kind] ?? BellIcon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openItem(item)}
                  tabIndex={open ? 0 : -1}
                  className={`flex w-full gap-3 px-4 py-3 text-left transition hover:bg-gray-50 ${
                    item.unread ? "bg-blue-50/40" : ""
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                      item.kind.startsWith("ai_usage_exhausted")
                        ? "bg-rose-50 text-rose-600"
                        : item.kind.startsWith("ai_usage")
                          ? "bg-amber-50 text-amber-600"
                          : "bg-blue-50 text-[#0A84FF]"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className={`text-sm leading-snug ${item.unread ? "font-semibold text-gray-900" : "text-gray-700"}`}>
                        {item.title}
                      </span>
                      {item.unread ? (
                        <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-[#0A84FF]" aria-label="Não lida" />
                      ) : null}
                    </span>
                    {item.body ? (
                      <span className="mt-0.5 block text-xs leading-snug text-gray-500">{item.body}</span>
                    ) : null}
                    {item.at ? (
                      <span className="mt-1 block text-[11px] text-gray-400">{timeAgo(item.at)}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
};
