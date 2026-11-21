import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLinkIcon, LocateFixedIcon, MapPinIcon } from "lucide-react";
import { Button } from "../ui/Button";
import { CloseButton } from "../ui/CloseButton";
import { supabase } from "../../lib/supabaseClient";
import {
  buildSharedLocation,
  isShortMapsLink,
  parseCoordinates,
  sharedLocationMapsUrl,
  type SharedLocation,
} from "../../lib/sharedLocation";

// Última localização enviada pela empresa neste navegador (o endereço da
// empresa costuma ser o mesmo): só para preencher o formulário
const lastLocationKey = (clinicId: string | null) =>
  `unxet:last-shared-location:${clinicId ?? "none"}`;

const readLastLocation = (clinicId: string | null): SharedLocation | null => {
  try {
    const raw = window.localStorage.getItem(lastLocationKey(clinicId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return buildSharedLocation(parsed);
  } catch {
    return null;
  }
};

const saveLastLocation = (clinicId: string | null, location: SharedLocation) => {
  try {
    window.localStorage.setItem(lastLocationKey(clinicId), JSON.stringify(location));
  } catch {
    // sem armazenamento do navegador: só não lembra
  }
};

const formatCoords = (latitude: number, longitude: number) =>
  `${latitude}, ${longitude}`;

const inputClass =
  "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]";

export const ShareLocationModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onConfirm: (location: SharedLocation) => void;
  clinicId: string | null;
}> = ({ open, onClose, onConfirm, clinicId }) => {
  const [place, setPlace] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const last = readLastLocation(clinicId);
    setPlace(last ? formatCoords(last.latitude, last.longitude) : "");
    setName(last?.name ?? "");
    setAddress(last?.address ?? "");
    setLocateError(null);
    setLocating(false);
  }, [open, clinicId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Link curto (maps.app.goo.gl): não traz as coordenadas, então o servidor
  // segue o redirecionamento e o campo recebe as coordenadas do destino
  const [resolvingLink, setResolvingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    setLinkError(null);
    if (!open || !isShortMapsLink(place)) {
      setResolvingLink(false);
      return;
    }
    let cancelled = false;
    setResolvingLink(true);
    void (async () => {
      const { data, error } = await supabase.functions.invoke("resolve-maps-link", {
        body: { url: place.trim() },
      });
      if (cancelled) return;
      setResolvingLink(false);
      if (error) {
        const response = (error as { context?: Response }).context;
        const payload = await response?.json?.().catch(() => null);
        if (cancelled) return;
        setLinkError(payload?.error ?? "Não foi possível abrir o link agora.");
        return;
      }
      const found = typeof data?.url === "string" ? parseCoordinates(data.url) : null;
      if (found) {
        setPlace(formatCoords(found.latitude, found.longitude));
      } else {
        setLinkError(
          "O link não trouxe as coordenadas do local. No Google Maps, toque e segure no ponto do mapa e copie as coordenadas que aparecem na busca.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, place]);

  const coords = useMemo(() => parseCoordinates(place), [place]);
  const location = useMemo(
    () => (coords ? buildSharedLocation({ ...coords, name, address }) : null),
    [coords, name, address],
  );
  const placeInvalid =
    place.trim().length > 0 && !coords && !resolvingLink && !isShortMapsLink(place);

  const useCurrentPosition = () => {
    if (!("geolocation" in navigator)) {
      setLocateError("Este navegador não informa a localização. Cole um link do Google Maps.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setPlace(
          formatCoords(
            Math.round(position.coords.latitude * 1e6) / 1e6,
            Math.round(position.coords.longitude * 1e6) / 1e6,
          ),
        );
      },
      (error) => {
        setLocating(false);
        setLocateError(
          error.code === error.PERMISSION_DENIED
            ? "O navegador não deu permissão para ver a localização. Libere nas configurações do site ou cole um link do Google Maps."
            : "Não foi possível descobrir a localização agora. Cole um link do Google Maps.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const send = () => {
    if (!location) return;
    saveLastLocation(clinicId, location);
    onConfirm(location);
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-location-title"
        className="absolute left-1/2 top-1/2 flex max-h-[90dvh] w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-5">
          <div>
            <h3 id="share-location-title" className="text-base font-semibold text-gray-900">
              Enviar localização
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              O cliente recebe um mapa que abre no aplicativo de mapas dele.
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label htmlFor="share-location-place" className="mb-1 block text-sm font-medium text-gray-700">
              Link do Google Maps ou coordenadas
            </label>
            <input
              id="share-location-place"
              value={place}
              onChange={(event) => setPlace(event.target.value)}
              placeholder="https://maps.google.com/... ou -1.4558, -48.4902"
              className={inputClass}
              autoFocus
            />
            <p
              className={`mt-1 text-xs ${placeInvalid || linkError ? "text-red-600" : "text-gray-500"}`}
              aria-live="polite"
            >
              {resolvingLink
                ? "Abrindo o link do Google Maps..."
                : linkError
                  ? linkError
                  : placeInvalid
                    ? "Não encontramos as coordenadas. Cole o link do Google Maps (o do botão Compartilhar também serve) ou as coordenadas, como -1,4558, -48,4902."
                    : "No Google Maps, abra o local e copie o link (da barra de endereço ou do botão Compartilhar)."}
            </p>
            <button
              type="button"
              onClick={useCurrentPosition}
              disabled={locating}
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[#0A84FF] hover:underline disabled:opacity-50"
            >
              <LocateFixedIcon className="h-4 w-4" aria-hidden />
              {locating ? "Descobrindo a localização..." : "Usar a localização deste aparelho"}
            </button>
            {locateError && <p className="mt-1 text-xs text-red-600">{locateError}</p>}
          </div>

          <div>
            <label htmlFor="share-location-name" className="mb-1 block text-sm font-medium text-gray-700">
              Nome do local <span className="font-normal text-gray-400">(opcional)</span>
            </label>
            <input
              id="share-location-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Nossa loja"
              maxLength={100}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="share-location-address" className="mb-1 block text-sm font-medium text-gray-700">
              Endereço <span className="font-normal text-gray-400">(opcional)</span>
            </label>
            <input
              id="share-location-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Ex.: Av. Nazaré, 100 - Belém"
              maxLength={200}
              className={inputClass}
            />
          </div>

          {location && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-sm text-gray-700">
                <MapPinIcon className="h-4 w-4 shrink-0 text-[#0A84FF]" aria-hidden />
                <span className="truncate">{formatCoords(location.latitude, location.longitude)}</span>
              </span>
              <a
                href={sharedLocationMapsUrl(location)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[#0A84FF] hover:underline"
              >
                Conferir no mapa
                <ExternalLinkIcon className="h-3.5 w-3.5" aria-hidden />
              </a>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 p-5">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!location} onClick={send}>
            Enviar
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
