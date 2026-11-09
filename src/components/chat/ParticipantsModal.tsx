import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Button } from "../ui/Button";
import { CloseButton } from "../ui/CloseButton";
import { UserIcon, UserPlusIcon, XIcon } from "lucide-react";

type ClinicMember = { userId: string; name: string };

export type ParticipantsModalProps = {
  open: boolean;
  onClose: () => void;
  clinicId: string | null;
  currentUserId: string | null;
  assignedTo?: string;
  participantIds: string[];
  names: Record<string, string>;
  /** Responsável ou quem atende todos os setores: adiciona e remove. */
  canManage: boolean;
  /** Só dá para adicionar com a conversa em atendimento. */
  canAdd: boolean;
  busyUserId: string | null;
  onAdd: (userId: string) => void;
  onRemove: (userId: string) => void;
};

const nameOf = (id: string, names: Record<string, string>) =>
  names[id] ?? "Atendente";

export const ParticipantsModal: React.FC<ParticipantsModalProps> = ({
  open,
  onClose,
  clinicId,
  currentUserId,
  assignedTo,
  participantIds,
  names,
  canManage,
  canAdd,
  busyUserId,
  onAdd,
  onRemove,
}) => {
  const [members, setMembers] = useState<ClinicMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setSearch("");
  }, [open]);

  useEffect(() => {
    if (!open || !clinicId || !canManage) return;
    let active = true;

    const load = async () => {
      setMembersLoading(true);
      // Só quem já aceitou o convite (a função recusa os demais)
      const { data, error } = await supabase
        .from("clinic_users")
        .select("user_id, name, email, accepted_at")
        .eq("clinic_id", clinicId)
        .not("accepted_at", "is", null);

      if (!active) return;
      if (!error) {
        setMembers(
          ((data as any[]) ?? [])
            .filter((row) => row?.user_id)
            .map((row) => ({
              userId: row.user_id,
              name: row.name || row.email || "Atendente",
            }))
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
        );
      }
      setMembersLoading(false);
    };

    void load();
    return () => {
      active = false;
    };
  }, [open, clinicId, canManage]);

  const candidates = useMemo(() => {
    const taken = new Set([...(assignedTo ? [assignedTo] : []), ...participantIds]);
    const term = search.trim().toLowerCase();
    return members.filter(
      (m) => !taken.has(m.userId) && (!term || m.name.toLowerCase().includes(term)),
    );
  }, [members, assignedTo, participantIds, search]);

  if (!open) return null;

  const isParticipant = !!currentUserId && participantIds.includes(currentUserId);

  return (
    <div className="fixed inset-0 z-[9999]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl border border-gray-200 bg-white shadow-xl sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[92vw] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 p-5">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900">
              Atendentes na conversa
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Quem for adicionado vê a conversa e responde junto com o
              responsável. O cliente recebe o nome de quem enviou cada
              mensagem.
            </p>
          </div>
          <CloseButton onClick={onClose} className="-mr-1 -mt-1" />
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <ul className="space-y-2">
            {assignedTo && (
              <li className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
                <UserIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                  {assignedTo === currentUserId ? "Você" : nameOf(assignedTo, names)}
                </span>
                <span className="flex-shrink-0 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">
                  Responsável
                </span>
              </li>
            )}

            {participantIds.map((id) => {
              const isMe = id === currentUserId;
              const canRemove = canManage || isMe;
              return (
                <li
                  key={id}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2"
                >
                  <UserIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                    {isMe ? "Você" : nameOf(id, names)}
                  </span>
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(id)}
                      disabled={!!busyUserId}
                      className="flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                      {busyUserId === id
                        ? isMe
                          ? "Saindo..."
                          : "Removendo..."
                        : isMe
                          ? "Sair"
                          : "Remover"}
                    </button>
                  )}
                </li>
              );
            })}

            {participantIds.length === 0 && (
              <li className="text-sm text-gray-500">
                Nenhum atendente adicionado ainda.
              </li>
            )}
          </ul>

          {canManage && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">
                Adicionar atendente
              </p>
              {!canAdd ? (
                <p className="text-xs text-amber-600">
                  Aceite a conversa antes de adicionar outros atendentes.
                </p>
              ) : (
                <>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar pelo nome"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  {membersLoading ? (
                    <p className="text-sm text-gray-500">Carregando...</p>
                  ) : candidates.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      Nenhum outro atendente disponível.
                    </p>
                  ) : (
                    <ul className="max-h-60 space-y-1 overflow-y-auto">
                      {candidates.map((m) => (
                        <li key={m.userId}>
                          <button
                            type="button"
                            onClick={() => onAdd(m.userId)}
                            disabled={!!busyUserId}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-800 transition-colors hover:bg-blue-50 disabled:opacity-50"
                          >
                            <UserPlusIcon className="h-4 w-4 flex-shrink-0 text-[#0A84FF]" />
                            <span className="min-w-0 flex-1 truncate">{m.name}</span>
                            {busyUserId === m.userId && (
                              <span className="text-xs text-gray-500">Adicionando...</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          {!canManage && isParticipant && (
            <p className="text-xs text-gray-500">
              Você foi adicionado por outro atendente. Só o responsável
              adiciona ou remove pessoas.
            </p>
          )}

          <div className="pb-[env(safe-area-inset-bottom)]" />
        </div>

        <div className="flex shrink-0 justify-end border-t border-gray-200 p-4">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
};
