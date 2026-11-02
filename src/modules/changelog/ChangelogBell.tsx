import { useEffect, useMemo, useRef, useState } from "react";
import {
  BellIcon,
  SparklesIcon,
  TrendingUpIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import {
  CHANGE_KIND_LABELS,
  CHANGE_KIND_ORDER,
  CURRENT_RELEASE,
  RELEASES,
  formatReleaseDate,
  type ChangeKind,
} from "./releases";

const KIND_STYLES: Record<ChangeKind, { icon: LucideIcon; className: string }> =
  {
    new: { icon: SparklesIcon, className: "bg-blue-50 text-[#0A84FF]" },
    improved: { icon: TrendingUpIcon, className: "bg-emerald-50 text-emerald-600" },
    fixed: { icon: WrenchIcon, className: "bg-amber-50 text-amber-600" },
  };

function seenKey(userId: string) {
  return `unxet:changelog-seen:${userId}`;
}

function readSeen(userId: string) {
  try {
    return window.localStorage.getItem(seenKey(userId));
  } catch {
    return null;
  }
}

interface ChangelogBellProps {
  userId?: string;
  isAdmin: boolean;
}

/**
 * Sino no topo com as novidades de cada versão. Mostra um ponto enquanto a
 * pessoa não abrir a versão atual (guardado por usuário, neste aparelho).
 */
export const ChangelogBell = ({ userId, isAdmin }: ChangelogBellProps) => {
  const [open, setOpen] = useState(false);
  const [seenVersion, setSeenVersion] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!userId) return;
    setSeenVersion(readSeen(userId));
    setLoaded(true);
  }, [userId]);

  const hasUnseen = loaded && seenVersion !== CURRENT_RELEASE.version;

  const releases = useMemo(
    () =>
      RELEASES.map((release) => ({
        ...release,
        groups: CHANGE_KIND_ORDER.map((kind) => ({
          kind,
          items: release.changes.filter(
            (c) => c.kind === kind && (isAdmin || !c.adminOnly),
          ),
        })).filter((g) => g.items.length > 0),
      })).filter((release) => release.groups.length > 0),
    [isAdmin],
  );

  const toggle = () => {
    setOpen((v) => !v);
    if (!open && userId && hasUnseen) {
      setSeenVersion(CURRENT_RELEASE.version);
      try {
        window.localStorage.setItem(seenKey(userId), CURRENT_RELEASE.version);
      } catch {
        // Sem storage o ponto volta no próximo carregamento.
      }
    }
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        (panelRef.current?.contains(target) ||
          buttonRef.current?.contains(target))
      ) {
        return;
      }
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

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0A84FF] focus:ring-offset-2"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          hasUnseen ? "Novidades da Unxet (nova atualização)" : "Novidades da Unxet"
        }
        title="Novidades da Unxet"
      >
        <BellIcon className="h-5 w-5" />
        {hasUnseen && (
          <span className="absolute right-1.5 top-1.5 flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75 motion-reduce:hidden" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />
          </span>
        )}
      </button>

      {/* Fica sempre montado para animar a abertura e o fechamento */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Novidades da Unxet"
        aria-hidden={!open}
        className={`absolute right-0 top-full z-50 mt-2 flex max-h-[min(32rem,calc(100vh-6rem))] w-96 max-w-[calc(100vw-1.5rem)] origin-top-right flex-col overflow-hidden rounded-lg border border-[#E5E7EB] bg-white shadow-lg transition-[opacity,transform,visibility] duration-150 ease-out motion-reduce:transition-none ${
          open
            ? "visible translate-y-0 scale-100 opacity-100"
            : "pointer-events-none invisible -translate-y-1 scale-95 opacity-0"
        }`}
      >
        <div className="border-b border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3">
          <div className="font-medium text-[#1E1E1E]">Novidades da Unxet</div>
          <div className="text-xs text-gray-500">
            Versão {CURRENT_RELEASE.version} · atualizada em{" "}
            {formatReleaseDate(CURRENT_RELEASE.date)}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          {releases.map((release, index) => (
            <section
              key={release.version}
              className={index > 0 ? "border-t border-[#E5E7EB]" : undefined}
            >
              <div className="flex items-baseline justify-between gap-2 px-4 pb-1 pt-3">
                <span className="text-sm font-semibold text-[#1E1E1E]">
                  Versão {release.version}
                  {index === 0 && (
                    <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-[#0A84FF]">
                      Atual
                    </span>
                  )}
                </span>
                <span className="text-xs text-gray-500">
                  {formatReleaseDate(release.date)}
                </span>
              </div>
              {release.groups.map(({ kind, items }) => {
                const { icon: Icon, className } = KIND_STYLES[kind];
                return (
                  <div key={kind} className="px-4 pb-3 pt-2">
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-md ${className}`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {CHANGE_KIND_LABELS[kind]}
                      </span>
                    </div>
                    <ul className="space-y-1.5 pl-8">
                      {items.map((item) => (
                        <li
                          key={item.text}
                          className="list-disc text-sm leading-snug text-gray-700 marker:text-gray-300"
                        >
                          {item.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </>
  );
};
