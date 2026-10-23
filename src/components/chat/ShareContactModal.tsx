import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { SearchIcon, UserIcon } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { Button } from "../ui/Button";
import {
  buildSharedContact,
  type SharedContact,
} from "../../lib/sharedContact";

type ContactRow = { id: string; name: string | null; phone: string | null };
type Mode = "base" | "manual";

const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 250;

const sanitizeSearch = (value: string) =>
  value.replace(/[,()"'\\%*]/g, " ").trim();

// Contatos da Evolution podem ter um LID (14+ dígitos) no lugar do telefone:
// não dá para compartilhar como cartão de contato
const isRealPhone = (phone: string | null) => {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13;
};

const formatPhone = (phone: string | null) => {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits ? `+${digits}` : "";
};

export const ShareContactModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onConfirm: (contact: SharedContact) => void;
  clinicId: string | null;
}> = ({ open, onClose, onConfirm, clinicId }) => {
  const [mode, setMode] = useState<Mode>("base");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  useEffect(() => {
    if (!open) return;
    setMode("base");
    setSearch("");
    setSelectedId(null);
    setManualName("");
    setManualPhone("");
  }, [open]);

  useEffect(() => {
    if (!open || mode !== "base" || !clinicId) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);

      let query = supabase
        .from("contacts")
        .select("id, name, phone")
        .eq("clinic_id", clinicId)
        .not("phone", "is", null)
        .order("last_seen_at", { ascending: false, nullsFirst: false })
        .limit(SEARCH_LIMIT);

      const term = sanitizeSearch(search);
      if (term) {
        query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
      }

      const { data, error } = await query;
      if (cancelled) return;
      if (error) console.error("Erro ao buscar contatos:", error);
      setResults(((data ?? []) as ContactRow[]).filter((c) => !!c.phone));
      setLoading(false);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, mode, search, clinicId]);

  const selected = useMemo(
    () => results.find((c) => c.id === selectedId) ?? null,
    [results, selectedId],
  );

  const contactToSend = useMemo<SharedContact | null>(() => {
    if (mode === "manual") return buildSharedContact(manualName, manualPhone);
    if (!selected || !isRealPhone(selected.phone)) return null;
    return buildSharedContact(
      selected.name?.trim() || formatPhone(selected.phone),
      // o telefone salvo já tem DDI
      formatPhone(selected.phone),
    );
  }, [mode, manualName, manualPhone, selected]);

  const manualPhoneInvalid =
    mode === "manual" &&
    manualPhone.trim().length > 0 &&
    !buildSharedContact("x", manualPhone);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="absolute left-1/2 top-1/2 flex max-h-[90dvh] w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="border-b border-gray-200 p-5">
          <h3 className="text-base font-semibold text-gray-900">
            Enviar contato
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            O cliente recebe um cartão de contato que pode salvar ou abrir no
            WhatsApp.
          </p>

          <div className="mt-4 flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
            {(
              [
                ["base", "Contatos da Empresa"],
                ["manual", "Digitar"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${
                  mode === value
                    ? "bg-white font-medium text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {mode === "base" ? (
          <div className="flex min-h-0 flex-1 flex-col p-5">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou telefone"
                className="w-full rounded-lg border border-[#E5E7EB] py-2 pl-9 pr-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
              />
            </div>

            <div className="mt-3 h-72 max-h-[45dvh] overflow-y-auto rounded-lg border border-gray-100">
              {loading && results.length === 0 ? (
                <p className="p-4 text-sm text-gray-500">Carregando...</p>
              ) : results.length === 0 ? (
                <p className="p-4 text-sm text-gray-500">
                  Nenhum contato encontrado.
                </p>
              ) : (
                results.map((c) => {
                  const valid = isRealPhone(c.phone);
                  const isSelected = c.id === selectedId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={!valid}
                      onClick={() => setSelectedId(c.id)}
                      className={`flex w-full items-center gap-3 border-b border-gray-100 px-3 py-2.5 text-left text-sm last:border-b-0 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        isSelected ? "bg-[#0A84FF]/10" : "hover:bg-gray-50"
                      }`}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100">
                        <UserIcon className="h-4 w-4 text-gray-500" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-gray-900">
                          {c.name?.trim() || "Sem nome"}
                        </span>
                        <span className="block truncate text-xs text-gray-500">
                          {valid ? formatPhone(c.phone) : "Sem telefone válido"}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Nome
              </label>
              <input
                autoFocus
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                maxLength={100}
                placeholder="Ex.: Recepção Unidade Centro"
                className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Telefone
              </label>
              <input
                value={manualPhone}
                onChange={(e) => setManualPhone(e.target.value)}
                inputMode="tel"
                placeholder="(11) 99999-9999"
                className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
              />
              <p
                className={`mt-1 text-xs ${
                  manualPhoneInvalid ? "text-red-500" : "text-gray-500"
                }`}
              >
                {manualPhoneInvalid
                  ? "Telefone inválido. Informe DDD e número."
                  : "Com DDD. Fora do Brasil, comece com + e o código do país."}
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-gray-200 p-5">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={!contactToSend}
            onClick={() => contactToSend && onConfirm(contactToSend)}
          >
            Enviar
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
