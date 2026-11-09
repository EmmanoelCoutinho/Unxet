import React, { useEffect, useState } from "react";
import { MessageCircleIcon } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { whatsappConnectionLabel } from "../../lib/whatsappConnections";
import { useOpenConversation } from "../../modules/floatingChats/useOpenConversation";

type OtherConversation = {
  id: string;
  status: "open" | "pending";
  numberLabel: string;
};

const STATUS_LABEL: Record<OtherConversation["status"], string> = {
  open: "em atendimento",
  pending: "na fila",
};

/**
 * O mesmo cliente também está falando com a empresa por outro número.
 * Cada número tem a própria conversa (e o próprio bot): o aviso deixa claro
 * que não é contato duplicado e leva para a outra conversa.
 */
export const OtherNumbersBanner: React.FC<{
  conversationId: string;
  contactId: string;
  contactName: string;
  /** Muda quando a conversa muda de status: busca de novo. */
  refreshKey?: string;
  compact?: boolean;
}> = ({ conversationId, contactId, contactName, refreshKey, compact }) => {
  const [others, setOthers] = useState<OtherConversation[]>([]);
  const openConversation = useOpenConversation();

  useEffect(() => {
    let active = true;

    const load = async () => {
      // Só as que a pessoa pode ver (o RLS esconde as de outros setores)
      const { data, error } = await supabase
        .from("conversations")
        .select(
          "id, status, channel_connection_id, channel_connections ( display_name, connected_phone, connected_name )",
        )
        .eq("contact_id", contactId)
        .eq("channel", "whatsapp")
        .neq("id", conversationId)
        .in("status", ["open", "pending"])
        .order("last_message_at", { ascending: false })
        .limit(5);

      if (!active || error) return;
      setOthers(
        ((data as any[]) ?? []).map((row) => ({
          id: row.id,
          status: row.status,
          numberLabel: whatsappConnectionLabel(row.channel_connections, "outro número"),
        })),
      );
    };

    void load();

    // Conversa nova ou mudança de status em outro número do mesmo cliente
    const channel = supabase
      .channel(`rt:contact_conversations:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `contact_id=eq.${contactId}`,
        },
        () => void load(),
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [conversationId, contactId, refreshKey]);

  if (others.length === 0) return null;

  return (
    <div
      className={`flex shrink-0 flex-col gap-1 border-b border-blue-100 bg-blue-50 text-blue-900 ${
        compact ? "px-3 py-1.5 text-[11px]" : "px-3 py-2 text-xs sm:px-4"
      }`}
    >
      {others.map((other) => (
        <div key={other.id} className="flex min-w-0 items-center gap-2">
          <MessageCircleIcon className="h-3.5 w-3.5 flex-shrink-0 text-blue-600" />
          <p className="min-w-0 flex-1 leading-snug">
            {contactName} também está falando pelo número{" "}
            <span className="font-semibold">{other.numberLabel}</span> (
            {STATUS_LABEL[other.status]}).
          </p>
          <button
            type="button"
            onClick={() => openConversation(other.id, { title: contactName })}
            className="flex-shrink-0 rounded-md px-2 py-0.5 font-semibold text-[#0A84FF] transition-colors hover:bg-blue-100"
          >
            Abrir
          </button>
        </div>
      ))}
    </div>
  );
};
