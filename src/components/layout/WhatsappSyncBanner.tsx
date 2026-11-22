import { useEffect, useState } from "react";
import { CheckCircle2Icon, RefreshCwIcon } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useClinic } from "../../contexts/ClinicContext";
import { whatsappConnectionLabel } from "../../lib/whatsappConnections";
import {
  whatsappSyncPercent,
  whatsappSyncState,
  type WhatsappSyncRow,
  type WhatsappSyncState,
} from "../../lib/whatsappSync";

type SyncConnection = WhatsappSyncRow & {
  id: string;
  display_name: string | null;
  connected_phone: string | null;
  connected_name: string | null;
};

const COLUMNS =
  "id, status, display_name, connected_phone, connected_name, inbound_recovery_requested_at, inbound_recovery_total, inbound_recovery_done, inbound_recovery_progress_at";

// Os prazos da faixa (procurando, parada, concluída) dependem do relógio
const TICK_MS = 15_000;
// Rede de segurança caso o Realtime caia
const REFRESH_MS = 2 * 60_000;

const message = (label: string, state: WhatsappSyncState) => {
  // Número sem apelido, telefone nem nome: só "WhatsApp"
  const whatsapp = label ? `WhatsApp ${label}` : "WhatsApp";
  if (state.kind === "searching") {
    return `Sincronizando o ${whatsapp}: buscando as mensagens recebidas enquanto ele esteve desconectado…`;
  }
  if (state.kind === "done") {
    return `Sincronização do ${whatsapp} concluída: ${state.total.toLocaleString("pt-BR")} mensagens trazidas.`;
  }
  return `Sincronizando o ${whatsapp}: ${state.done.toLocaleString("pt-BR")} de ${state.total.toLocaleString("pt-BR")} mensagens recebidas enquanto ele esteve desconectado.`;
};

/**
 * Faixa abaixo da barra superior enquanto um número por QR Code traz as
 * mensagens que chegaram com ele desconectado (depois de ler o QR Code de
 * novo). Aparece para toda a equipe: as conversas vão surgindo aos poucos.
 */
export const WhatsappSyncBanner = () => {
  const { clinicId } = useClinic();
  const [connections, setConnections] = useState<SyncConnection[]>([]);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!clinicId) {
      setConnections([]);
      return;
    }
    let active = true;

    const load = async () => {
      const { data, error } = await supabase
        .from("channel_connections")
        .select(COLUMNS)
        .eq("clinic_id", clinicId)
        .eq("provider", "evolution")
        .is("archived_at", null);
      if (!active || error) return;
      setConnections((data ?? []) as SyncConnection[]);
      setNow(new Date());
    };

    void load();

    const channel = supabase
      .channel(`whatsapp-sync:${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "channel_connections",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          const next = payload.new as Partial<SyncConnection>;
          if (!next?.id) return;
          setConnections((current) =>
            current.map((connection) =>
              connection.id === next.id ? { ...connection, ...next } : connection,
            ),
          );
          setNow(new Date());
        },
      )
      .subscribe();

    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [clinicId]);

  const visible = connections
    .map((connection) => ({ connection, state: whatsappSyncState(connection, now) }))
    .filter((item): item is { connection: SyncConnection; state: WhatsappSyncState } => !!item.state);

  // O relógio só precisa andar enquanto há algo na tela
  const hasVisible = visible.length > 0;
  useEffect(() => {
    if (!hasVisible) return;
    const timer = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [hasVisible]);

  if (!hasVisible) return null;

  return (
    <>
      {visible.map(({ connection, state }) => {
        const done = state.kind === "done";
        const percent = whatsappSyncPercent(state);
        return (
          <div
            key={connection.id}
            role="status"
            className={[
              "flex shrink-0 flex-col gap-1.5 border-b px-3 py-2 text-xs font-medium sm:text-sm",
              done
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-sky-200 bg-sky-50 text-sky-900",
            ].join(" ")}
          >
            <div className="flex items-center justify-center gap-2 text-center">
              {done ? (
                <CheckCircle2Icon className="h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <RefreshCwIcon className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              )}
              <span>{message(whatsappConnectionLabel(connection, ""), state)}</span>
            </div>
            <div
              className={[
                "mx-auto h-1.5 w-full max-w-xl overflow-hidden rounded-full",
                done ? "bg-emerald-100" : "bg-sky-100",
              ].join(" ")}
              role="progressbar"
              aria-label="Progresso da sincronização"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={state.kind === "searching" ? undefined : percent}
            >
              {state.kind === "searching" ? (
                <div className="h-full w-1/3 animate-pulse rounded-full bg-sky-400" />
              ) : (
                <div
                  className={[
                    "h-full rounded-full transition-[width] duration-500",
                    done ? "bg-emerald-500" : "bg-sky-500",
                  ].join(" ")}
                  style={{ width: `${percent}%` }}
                />
              )}
            </div>
          </div>
        );
      })}
    </>
  );
};
