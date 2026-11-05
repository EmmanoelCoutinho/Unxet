import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRightIcon, PlayCircleIcon, XIcon } from "lucide-react";
import {
  TUTORIALS,
  markTutorialWatched,
  readWatchedTutorials,
  type Tutorial,
} from "./tutorials";

type PlayerProps = {
  tutorial: Tutorial | null;
  onClose: () => void;
  /** Avisado quando o vídeo termina ou a pessoa marca como assistido */
  onWatched?: (id: string) => void;
  watched?: boolean;
};

/** Player do tutorial em vídeo (usado na tela Tutoriais e nos atalhos das telas) */
export const TutorialPlayer: React.FC<PlayerProps> = ({
  tutorial,
  onClose,
  onWatched,
  watched = false,
}) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const markWatched = (id: string) => {
    markTutorialWatched(id);
    onWatched?.(id);
  };

  // Aberto na própria tela que ele ensina: não precisa do "Ir para a tela"
  const showGoTo = tutorial?.path && tutorial.path !== pathname;

  return (
    <Dialog.Root open={tutorial !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none">
          {tutorial && (
            <>
              <div className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <Dialog.Title className="text-base font-semibold text-gray-900">
                    {tutorial.title}
                  </Dialog.Title>
                  <Dialog.Description className="text-sm text-gray-500">
                    {tutorial.description}
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
                key={tutorial.id}
                src={tutorial.video}
                controls
                autoPlay
                playsInline
                onEnded={() => markWatched(tutorial.id)}
                className="aspect-video w-full bg-black"
              />
              <div className="flex flex-wrap items-center justify-end gap-3 px-5 py-3">
                {!watched && (
                  <button
                    type="button"
                    onClick={() => markWatched(tutorial.id)}
                    className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:border-gray-300"
                  >
                    Marcar como assistido
                  </button>
                )}
                {showGoTo && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      if (tutorial.path) navigate(tutorial.path);
                    }}
                    className="inline-flex items-center gap-2 rounded-full bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-600"
                  >
                    Ir para a tela
                    <ArrowRightIcon className="h-4 w-4" />
                  </button>
                )}
                {!showGoTo && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-full bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-600"
                  >
                    Entendi
                  </button>
                )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

/**
 * Link "Ver tutorial". Padrão: logo embaixo do subtítulo da tela (ou da
 * descrição do cartão), longe dos botões de ação do cabeçalho.
 * Some sozinho enquanto o tutorial ainda não tem vídeo.
 */
export const TutorialButton: React.FC<{
  tutorialId: string;
  className?: string;
}> = ({ tutorialId, className = "" }) => {
  const tutorial = TUTORIALS.find((t) => t.id === tutorialId);
  const [open, setOpen] = useState(false);
  const [watched, setWatched] = useState(() =>
    readWatchedTutorials().includes(tutorialId),
  );

  if (!tutorial?.video) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={tutorial.title}
        className={`inline-flex items-center gap-1.5 rounded text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline ${className}`}
      >
        <PlayCircleIcon className="h-4 w-4" />
        Ver tutorial
      </button>
      <TutorialPlayer
        tutorial={open ? tutorial : null}
        onClose={() => setOpen(false)}
        watched={watched}
        onWatched={() => setWatched(true)}
      />
    </>
  );
};
