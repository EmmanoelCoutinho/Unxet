import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  ClockIcon,
  GraduationCapIcon,
  PlayIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import PreTitleIcon from "../components/ui/PreTitleIcon";
import { useClinic } from "../contexts/ClinicContext";
import {
  TUTORIALS,
  TUTORIAL_TRACKS,
  readWatchedTutorials,
  saveWatchedTutorials,
  type Tutorial,
} from "../modules/tutorials/tutorials";

const normalize = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const TutorialsPage: React.FC = () => {
  const navigate = useNavigate();
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

  const markWatched = (id: string) => {
    setWatched((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      saveWatchedTutorials(next);
      return next;
    });
  };

  const goToScreen = (path: string) => {
    setPlaying(null);
    navigate(path);
  };

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

      <Dialog.Root
        open={playing !== null}
        onOpenChange={(open) => !open && setPlaying(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none">
            {playing && (
              <>
                <div className="flex items-start justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <Dialog.Title className="text-base font-semibold text-gray-900">
                      {playing.title}
                    </Dialog.Title>
                    <Dialog.Description className="text-sm text-gray-500">
                      {playing.description}
                    </Dialog.Description>
                  </div>
                  <Dialog.Close
                    className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                    aria-label="Fechar"
                  >
                    <XIcon className="h-5 w-5" />
                  </Dialog.Close>
                </div>
                <video
                  key={playing.id}
                  src={playing.video}
                  controls
                  autoPlay
                  playsInline
                  onEnded={() => markWatched(playing.id)}
                  className="aspect-video w-full bg-black"
                />
                <div className="flex flex-wrap items-center justify-end gap-3 px-5 py-3">
                  {!watched.includes(playing.id) && (
                    <button
                      type="button"
                      onClick={() => markWatched(playing.id)}
                      className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:border-gray-300"
                    >
                      Marcar como assistido
                    </button>
                  )}
                  {playing.path && (
                    <button
                      type="button"
                      onClick={() => playing.path && goToScreen(playing.path)}
                      className="inline-flex items-center gap-2 rounded-full bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-600"
                    >
                      Ir para a tela
                      <ArrowRightIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
};

export default TutorialsPage;
