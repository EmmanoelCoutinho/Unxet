import { useEffect, useMemo } from "react";
import { RocketIcon, SparklesIcon, TrendingUpIcon, WrenchIcon, type LucideIcon } from "lucide-react";
import PreTitleIcon from "../components/ui/PreTitleIcon";
import { useAuth } from "../contexts/AuthContext";
import { useClinic } from "../contexts/ClinicContext";
import { IS_PRODUCTION } from "../lib/environment";
import {
  CHANGE_KIND_LABELS,
  CHANGE_KIND_ORDER,
  CURRENT_RELEASE,
  RELEASES,
  UPCOMING_RELEASE,
  formatReleaseDate,
  releaseNotice,
  type ChangeKind,
  type ReleaseChange,
} from "../modules/changelog/releases";

const KIND_STYLES: Record<ChangeKind, { icon: LucideIcon; className: string }> = {
  new: { icon: SparklesIcon, className: "bg-blue-50 text-[#0A84FF]" },
  improved: { icon: TrendingUpIcon, className: "bg-emerald-50 text-emerald-600" },
  fixed: { icon: WrenchIcon, className: "bg-amber-50 text-amber-600" },
};

function groupChanges(changes: ReleaseChange[], isAdmin: boolean) {
  return CHANGE_KIND_ORDER.map((kind) => ({
    kind,
    items: changes.filter((c) => c.kind === kind && (isAdmin || !c.adminOnly)),
  })).filter((g) => g.items.length > 0);
}

function ChangeGroups({ groups }: { groups: { kind: ChangeKind; items: ReleaseChange[] }[] }) {
  return (
    <div className="space-y-4">
      {groups.map(({ kind, items }) => {
        const { icon: Icon, className } = KIND_STYLES[kind];
        return (
          <div key={kind}>
            <div className="mb-2 flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-md ${className}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {CHANGE_KIND_LABELS[kind]}
              </span>
            </div>
            <ul className="space-y-2 pl-8">
              {items.map((item) => (
                <li key={item.text} className="list-disc text-sm leading-relaxed text-gray-700 marker:text-gray-300">
                  {item.text}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Novidades da Unxet: o que mudou em cada versão. Abre pelo aviso "sistema
 * atualizado" do sino e fica como histórico.
 */
export const ReleaseNotesPage = () => {
  const { membership } = useClinic();
  const { authUser } = useAuth();
  const isAdmin = membership?.role === "admin";

  // Abriu a tela: o aviso da versão some do sino
  useEffect(() => {
    if (!authUser?.id) return;
    try {
      window.localStorage.setItem(
        `unxet:changelog-seen:${authUser.id}`,
        releaseNotice(undefined, undefined, IS_PRODUCTION).key,
      );
    } catch {
      // sem armazenamento: o aviso continua no sino
    }
  }, [authUser?.id]);

  const releases = useMemo(
    () =>
      RELEASES.map((release) => ({ ...release, groups: groupChanges(release.changes, isAdmin) })).filter(
        (release) => release.groups.length > 0,
      ),
    [isAdmin],
  );

  // Fora da produção, mostra o que entra na próxima versão (ainda em teste)
  const upcoming = useMemo(() => {
    if (IS_PRODUCTION || !UPCOMING_RELEASE) return null;
    const groups = groupChanges(UPCOMING_RELEASE.changes, isAdmin);
    return groups.length > 0 ? { version: UPCOMING_RELEASE.version, groups } : null;
  }, [isAdmin]);

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="border-b bg-white px-4 pb-4 pt-6 sm:px-10 sm:pt-8">
        <div className="flex items-center gap-3">
          <PreTitleIcon icon={RocketIcon} />
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Novidades da Unxet</h1>
            <p className="text-sm text-gray-500">
              Versão {CURRENT_RELEASE.version} · atualizada em {formatReleaseDate(CURRENT_RELEASE.date)}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-10">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {upcoming ? (
            <section className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 p-5">
              <div className="mb-4 flex items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-900">
                  Versão {upcoming.version}
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    Em teste
                  </span>
                </h2>
                <span className="text-xs text-gray-500">próxima versão</span>
              </div>
              <ChangeGroups groups={upcoming.groups} />
            </section>
          ) : null}
          {releases.map((release, index) => (
            <section key={release.version} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-900">
                  Versão {release.version}
                  {index === 0 ? (
                    <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-[#0A84FF]">
                      Atual
                    </span>
                  ) : null}
                </h2>
                <span className="text-xs text-gray-500">{formatReleaseDate(release.date)}</span>
              </div>
              <ChangeGroups groups={release.groups} />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ReleaseNotesPage;
