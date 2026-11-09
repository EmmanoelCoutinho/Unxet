import React, { useEffect, useState } from "react";
import { MessageCircleIcon } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import { whatsappConnectionLabel } from "../../../lib/whatsappConnections";
import { useOpenConversation } from "../../floatingChats/useOpenConversation";
import { formatDateTime } from "../../../components/contacts/contactLabels";

type ContactConversationRow = {
  id: string;
  channel: "whatsapp" | "instagram" | "messenger";
  status: "open" | "pending" | "closed";
  in_bot_flow: boolean | null;
  last_message_at: string | null;
  channel_connections: {
    display_name: string | null;
    connected_phone: string | null;
    connected_name: string | null;
  } | null;
};

const CHANNEL_NAME: Record<ContactConversationRow["channel"], string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
};

const statusBadge = (row: ContactConversationRow) => {
  if (row.status === "pending" && row.in_bot_flow) {
    return { label: "No bot", className: "bg-violet-50 text-violet-700" };
  }
  if (row.status === "open") {
    return { label: "Em atendimento", className: "bg-green-50 text-green-700" };
  }
  if (row.status === "pending") {
    return { label: "Na fila", className: "bg-amber-50 text-amber-700" };
  }
  return { label: "Finalizada", className: "bg-gray-100 text-gray-600" };
};

/**
 * Conversas do cliente, uma por número/canal. O contato é um só; cada
 * número da empresa tem a própria conversa.
 */
export const ContactConversations: React.FC<{
  contactId: string;
  contactName: string;
}> = ({ contactId, contactName }) => {
  const [rows, setRows] = useState<ContactConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const openConversation = useOpenConversation();

  useEffect(() => {
    let active = true;
    setLoading(true);

    const load = async () => {
      // O RLS mostra só as conversas que a pessoa pode ver
      const { data, error } = await supabase
        .from("conversations")
        .select(
          "id, channel, status, in_bot_flow, last_message_at, channel_connections ( display_name, connected_phone, connected_name )",
        )
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(20);

      if (!active) return;
      setRows(error ? [] : ((data as unknown as ContactConversationRow[]) ?? []));
      setLoading(false);
    };

    void load();
    return () => {
      active = false;
    };
  }, [contactId]);

  return (
    <div className="border-t border-gray-100 p-4 sm:p-5">
      <h3 className="text-base font-semibold text-gray-950">Conversas</h3>
      <p className="mt-1 text-sm text-gray-500">
        Uma conversa por número da empresa em que o cliente falou.
      </p>

      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="text-sm text-gray-500">Carregando conversas...</p>
        ) : rows.length === 0 ? (
          <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">
            Nenhuma conversa com este cliente.
          </p>
        ) : (
          rows.map((row) => {
            const badge = statusBadge(row);
            const where =
              row.channel === "whatsapp"
                ? whatsappConnectionLabel(row.channel_connections)
                : CHANNEL_NAME[row.channel] ?? "Conversa";
            return (
              <div
                key={row.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2"
              >
                <MessageCircleIcon className="h-4 w-4 flex-shrink-0 text-green-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {row.channel === "whatsapp" ? `Número ${where}` : where}
                  </p>
                  <p className="text-xs text-gray-500">
                    Última mensagem: {formatDateTime(row.last_message_at)}
                  </p>
                </div>
                <span
                  className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.className}`}
                >
                  {badge.label}
                </span>
                <button
                  type="button"
                  onClick={() => openConversation(row.id, { title: contactName })}
                  className="flex-shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-[#0A84FF] transition-colors hover:bg-blue-50"
                >
                  Abrir
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
