import React, { useMemo, useState } from "react";
import {
  CheckCircle2Icon,
  ClockIcon,
  GraduationCapIcon,
  PlayIcon,
  SearchIcon,
} from "lucide-react";
import PreTitleIcon from "../components/ui/PreTitleIcon";
import { useClinic } from "../contexts/ClinicContext";
import {
  TUTORIALS,
  TUTORIAL_TRACKS,
  readWatchedTutorials,
  type Tutorial,
} from "../modules/tutorials/tutorials";
import { TutorialPlayer } from "../modules/tutorials/TutorialPlayer";

const normalize = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const TutorialsPage: React.FC = () => {
  const { membership } = useClinic();
  const isAdmin = membership?.role === "admin";
  const [search, setSearch] = useState("");
  const [watched, setWatched] = useState<string[]>(readWatchedTutorials);
  const [playing, setPlaying] = useState<Tutorial | null>(null);

  const visible = useMemo(
    () => TUTORIALS.filter((t) => isAdmin || !t.adminOnly),
    [isAdmin],
  );

  const tracks = useMemo(() => {
    const term = normalize(search.trim());
    return TUTORIAL_TRACKS.map((track) => {
      const all = visible.filter((t) => t.track === track.id);
      const items = term
        ? all.filter((t) =>
            normalize(`${t.title} ${t.description}`).includes(term),
          )
        : all;
      const available = all.filter((t) => t.video);
      const done = available.filter((t) => watched.includes(t.id)).length;
      return { ...track, items, available: available.length, done };
    }).filter((track) => track.items.length > 0);
  }, [visible, search, watched]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      <div className="border-b bg-white px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <PreTitleIcon icon={GraduationCapIcon} />
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Tutoriais</h1>
              <p className="text-sm text-gray-500">
                Vídeos curtos que mostram, passo a passo, como usar a Unxet.
              </p>
            </div>
          </div>
          <div className="relative w-full sm:w-72">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar tutorial"
              className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-700 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>
      </div>

      <div className="space-y-8 px-4 py-6 sm:px-6">
        {tracks.length === 0 && (
          <p className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-500">
            Nenhum tutorial encontrado para "{search}".
          </p>
        )}

        {tracks.map((track) => (
          <section key={track.id} aria-labelledby={`trilha-${track.id}`}>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2
                  id={`trilha-${track.id}`}
                  className="text-lg font-semibold text-gray-900"
                >
                  {track.title}
                </h2>
                <p className="text-sm text-gray-500">{track.description}</p>
              </div>
              {track.available > 0 && (
                <span className="text-xs font-medium text-gray-500">
                  {track.done} de {track.available} assistidos
                </span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {track.items.map((tutorial) => {
                const ready = Boolean(tutorial.video);
                const seen = watched.includes(tutorial.id);
                return (
                  <button
                    key={tutorial.id}
                    type="button"
                    disabled={!ready}
                    onClick={() => setPlaying(tutorial)}
                    className="group flex items-start gap-3 rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition enabled:hover:border-blue-200 enabled:hover:shadow-md disabled:cursor-default"
                  >
                    <span
                      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
                        seen
                          ? "bg-emerald-50 text-emerald-600"
                          : ready
                            ? "bg-blue-50 text-blue-600 group-hover:bg-blue-100"
                            : "bg-gray-100 text-gray-400"
                      }`}
                      aria-hidden="true"
                    >
                      {seen ? (
                        <CheckCircle2Icon className="h-5 w-5" />
                      ) : ready ? (
                        <PlayIcon className="h-4 w-4" />
                      ) : (
                        <ClockIcon className="h-4 w-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-sm font-semibold ${
                          ready ? "text-gray-900" : "text-gray-500"
                        }`}
                      >
                        {tutorial.title}
                      </span>
                      <span className="mt-0.5 block text-sm text-gray-500">
                        {tutorial.description}
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        {!ready && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-500">
                            Em breve
                          </span>
                        )}
                        {seen && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                            Assistido
                          </span>
                        )}
                        {tutorial.duration && (
                          <span className="text-gray-400">{tutorial.duration}</span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <TutorialPlayer
        tutorial={playing}
        onClose={() => setPlaying(null)}
        watched={playing ? watched.includes(playing.id) : false}
        onWatched={(id) =>
          setWatched((prev) => (prev.includes(id) ? prev : [...prev, id]))
        }
      />
    </div>
  );
};

export default TutorialsPage;
