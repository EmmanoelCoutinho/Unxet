import React, { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { supabase } from "../../../lib/supabaseClient";
import { whatsappConnectionLabel } from "../../../lib/whatsappConnections";
import { useWhatsappConnections } from "../../../hooks/useWhatsappConnections";
import { useOpenConversation } from "../../floatingChats/useOpenConversation";
import { FIELD_CLASS, LABEL_CLASS, LeadModal } from "../../leads/components/LeadModal";
import {
  formatPhone,
  normalizeTypedPhone,
  recipientLabel,
} from "../../scheduledMessages/utils/schedule";
import { contactQueryKeys } from "../hooks/useContacts";

type PresetContact = { id: string; name: string | null; phone: string | null };

/**
 * Cadastra um cliente na carteira (nome + número) e/ou inicia uma conversa
 * com ele por um número QR Code da empresa. A conversa abre já em
 * atendimento com quem iniciou, pronta para enviar mensagem.
 */
export const StartConversationModal: React.FC<{
  clinicId: string;
  // Cliente da carteira: só escolhe o número
  contact?: PresetContact;
  onClose: () => void;
  onSaved?: (contactId: string) => void;
}> = ({ clinicId, contact, onClose, onSaved }) => {
  const queryClient = useQueryClient();
  const openConversation = useOpenConversation();
  const { connections, loading: connectionsLoading } = useWhatsappConnections(clinicId);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [busy, setBusy] = useState<"save" | "start" | null>(null);

  // Texto livre para puxar conversa só sai pelo QR Code: no WhatsApp oficial a
  // Meta exige modelo aprovado (Campanhas)
  const qrNumbers = useMemo(
    () =>
      connections.filter(
        (c) => c.provider === "evolution" && c.status === "connected" && !c.archived_at,
      ),
    [connections],
  );
  const hasOfficial = connections.some((c) => c.provider === "meta" && !c.archived_at);

  useEffect(() => {
    if (!connectionId && qrNumbers[0]) setConnectionId(qrNumbers[0].id);
  }, [qrNumbers, connectionId]);

  const submit = async (start: boolean) => {
    const typedPhone = contact ? null : normalizeTypedPhone(phone);
    if (!contact) {
      if (!name.trim()) {
        toast.error("Informe o nome do cliente.");
        return;
      }
      if (!typedPhone) {
        toast.error("Número inválido. Use DDD + número, por exemplo (11) 98765-4321.");
        return;
      }
    }
    if (start && !connectionId) {
      toast.error("Escolha por qual número da empresa falar.");
      return;
    }

    setBusy(start ? "start" : "save");
    const { data, error } = await supabase.functions.invoke("start-conversation", {
      body: {
        clinicId,
        contactId: contact?.id ?? null,
        name: contact ? null : name.trim(),
        phone: typedPhone,
        connectionId: start ? connectionId : null,
      },
    });
    setBusy(null);

    if (error) {
      const response = (error as { context?: Response }).context;
      const payload = await response?.json?.().catch(() => null);
      toast.error(payload?.error ?? "Não foi possível salvar.");
      return;
    }

    const result = data as { contactId: string; conversationId: string | null };
    void queryClient.invalidateQueries({ queryKey: contactQueryKeys.all });
    onSaved?.(result.contactId);

    if (start && result.conversationId) {
      const title = contact ? recipientLabel({ name: contact.name, phone: contact.phone ?? "" }) : name.trim();
      openConversation(result.conversationId, { title });
      toast.success("Conversa iniciada. Já pode enviar a mensagem.");
    } else {
      toast.success("Cliente salvo na carteira.");
    }
    onClose();
  };

  return (
    <LeadModal
      title={contact ? "Iniciar conversa" : "Novo cliente"}
      subtitle={
        contact
          ? `${recipientLabel({ name: contact.name, phone: contact.phone ?? "" })} · ${formatPhone(contact.phone)}`
          : "Cadastre o cliente e, se quiser, já comece a conversa."
      }
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (contact && qrNumbers.length === 0) return;
          void submit(qrNumbers.length > 0);
        }}
        className="space-y-4"
      >
        {!contact && (
          <>
            <div>
              <label htmlFor="new-contact-name" className={LABEL_CLASS}>
                Nome
              </label>
              <input
                id="new-contact-name"
                type="text"
                value={name}
                maxLength={120}
                autoFocus
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Ana Souza"
                className={`${FIELD_CLASS} mt-1`}
              />
            </div>
            <div>
              <label htmlFor="new-contact-phone" className={LABEL_CLASS}>
                WhatsApp do cliente
              </label>
              <input
                id="new-contact-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="(11) 98765-4321"
                className={`${FIELD_CLASS} mt-1`}
              />
              <p className="mt-1 text-xs text-slate-500">
                DDD + número. Para outro país, comece com o código do país.
              </p>
            </div>
          </>
        )}

        <div>
          <label htmlFor="start-connection" className={LABEL_CLASS}>
            Falar pelo número
          </label>
          {connectionsLoading ? (
            <p className="mt-1 text-sm text-slate-500">Carregando números...</p>
          ) : qrNumbers.length === 0 ? (
            <p className="mt-1 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Nenhum WhatsApp por QR Code conectado.
              {hasOfficial
                ? " Pelo WhatsApp oficial, o primeiro contato precisa de um modelo aprovado: use Campanhas."
                : " Conecte um número em Integrações para iniciar conversas."}
            </p>
          ) : (
            <>
              <select
                id="start-connection"
                value={connectionId}
                onChange={(event) => setConnectionId(event.target.value)}
                className={`${FIELD_CLASS} mt-1`}
              >
                {qrNumbers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {whatsappConnectionLabel(c)}
                  </option>
                ))}
              </select>
              {hasOfficial && (
                <p className="mt-1 text-xs text-slate-500">
                  O WhatsApp oficial não aparece aqui: a Meta exige modelo aprovado
                  para o primeiro contato (use Campanhas).
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
          {!contact && (
            <button
              type="button"
              onClick={() => void submit(false)}
              disabled={busy !== null}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              {busy === "save" ? "Salvando..." : "Só salvar"}
            </button>
          )}
          {qrNumbers.length > 0 && (
            <button
              type="submit"
              disabled={busy !== null}
              className="rounded-xl bg-[#0A84FF] px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:opacity-60"
            >
              {busy === "start" ? "Iniciando..." : contact ? "Iniciar conversa" : "Salvar e iniciar conversa"}
            </button>
          )}
        </div>
      </form>
    </LeadModal>
  );
};
