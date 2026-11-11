import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BanIcon, PlusIcon, SearchIcon } from "lucide-react";
import { toast } from "react-toastify";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import PreTitleIcon from "../components/ui/PreTitleIcon";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { BlockContactModal } from "../modules/contacts/components/BlockContactModal";
import {
  type BlockedContact,
  formatBlockedIdentifier,
  listBlockedContacts,
  unblockContact,
} from "../modules/contacts/api/blocking";

const formatDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

const blockedMessagesLabel = (contact: BlockedContact) => {
  if (contact.blockedMessages === 0) return "Nenhuma mensagem barrada até agora";
  const count =
    contact.blockedMessages === 1
      ? "1 mensagem barrada"
      : `${contact.blockedMessages} mensagens barradas`;
  return contact.lastBlockedMessageAt
    ? `${count} · última em ${formatDateTime(contact.lastBlockedMessageAt)}`
    : count;
};

/** Contatos que a empresa bloqueou: as mensagens deles nem entram no sistema. */
const BlockedContactsPage: React.FC = () => {
  const confirm = useConfirm();
  const [contacts, setContacts] = useState<BlockedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isBlocking, setIsBlocking] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setContacts(await listBlockedContacts());
    } catch (err: any) {
      setError(err?.message ?? "Não foi possível carregar os contatos bloqueados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return contacts;
    const digits = term.replace(/\D/g, "");
    return contacts.filter(
      (contact) =>
        (contact.name ?? "").toLowerCase().includes(term) ||
        (contact.reason ?? "").toLowerCase().includes(term) ||
        (digits !== "" && (contact.phone ?? "").replace(/\D/g, "").includes(digits)),
    );
  }, [contacts, search]);

  const handleUnblock = async (contact: BlockedContact) => {
    const label = contact.name || formatBlockedIdentifier(contact.phone) || "este contato";
    const ok = await confirm({
      title: "Desbloquear contato",
      description: `As mensagens de ${label} voltam a chegar normalmente e a empresa pode enviar para ele de novo. O que foi barrado durante o bloqueio não é recuperado.`,
      confirmLabel: "Desbloquear",
      tone: "warning",
    });
    if (!ok) return;
    setUnblockingId(contact.id);
    try {
      await unblockContact(contact.id);
      setContacts((current) => current.filter((item) => item.id !== contact.id));
      toast.success("Contato desbloqueado.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível desbloquear o contato.");
    } finally {
      setUnblockingId(null);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      <div className="border-b bg-white px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <PreTitleIcon icon={BanIcon} />
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Contatos bloqueados</h1>
              <p className="text-sm text-gray-500">
                As mensagens de quem está aqui são descartadas assim que chegam: não abrem conversa,
                não acionam bot nem IA. A empresa também não envia para eles.
              </p>
            </div>
          </div>
          <Button type="button" onClick={() => setIsBlocking(true)} className="rounded-full">
            <span className="flex items-center gap-2 whitespace-nowrap">
              <PlusIcon className="h-4 w-4" />
              Bloquear número
            </span>
          </Button>
        </div>
      </div>

      <div className="space-y-4 px-4 py-6 sm:px-6">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <Card className="p-4 sm:p-6">
          {contacts.length > 0 && (
            <div className="relative mb-4 max-w-sm">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nome, número ou motivo"
                aria-label="Buscar contato bloqueado"
                className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}

          {loading ? (
            <p className="text-sm text-gray-500">Carregando contatos bloqueados...</p>
          ) : contacts.length === 0 ? (
            <p className="text-sm text-gray-500">
              Nenhum contato bloqueado. Para bloquear alguém que já escreveu, abra a conversa e use{" "}
              <span className="font-medium text-gray-700">Mais ações &gt; Bloquear contato</span>.
            </p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum contato bloqueado com essa busca.</p>
          ) : (
            <ul className="space-y-3">
              {visible.map((contact) => {
                const identifier = formatBlockedIdentifier(contact.phone);
                return (
                  <li
                    key={contact.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {contact.name || identifier || "Contato sem nome"}
                      </p>
                      <p className="text-xs text-gray-500">
                        {[
                          contact.name ? identifier : "",
                          `Bloqueado em ${formatDateTime(contact.blockedAt)}`,
                          contact.blockedByName ? `por ${contact.blockedByName}` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {contact.reason && (
                        <p className="mt-1 break-words text-xs text-gray-700">Motivo: {contact.reason}</p>
                      )}
                      <p className="mt-1 text-xs text-gray-500">{blockedMessagesLabel(contact)}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={unblockingId === contact.id}
                      onClick={() => void handleUnblock(contact)}
                    >
                      {unblockingId === contact.id ? "Desbloqueando..." : "Desbloquear"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {isBlocking && (
        <BlockContactModal onClose={() => setIsBlocking(false)} onBlocked={() => void load()} />
      )}
    </div>
  );
};

export default BlockedContactsPage;
