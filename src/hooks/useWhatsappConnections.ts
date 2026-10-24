import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export type WhatsappConnectionRow = {
  id: string;
  provider: "meta" | "evolution";
  status: string;
  display_name: string | null;
  connected_phone: string | null;
  connected_name: string | null;
  archived_at: string | null;
};

// Números de WhatsApp da empresa, inclusive os removidos (as conversas antigas
// continuam ligadas a eles)
export function useWhatsappConnections(clinicId: string | null | undefined) {
  const [connections, setConnections] = useState<WhatsappConnectionRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clinicId) {
      setConnections([]);
      return;
    }

    let active = true;

    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("channel_connections")
        .select(
          "id, provider, status, display_name, connected_phone, connected_name, archived_at, created_at",
        )
        .eq("clinic_id", clinicId)
        .eq("channel", "whatsapp")
        .order("created_at", { ascending: true });

      if (!active) return;
      setLoading(false);
      if (error) return;
      setConnections((data ?? []) as WhatsappConnectionRow[]);
    };

    void load();

    return () => {
      active = false;
    };
  }, [clinicId]);

  return {
    connections,
    loading,
    // O número da conversa só aparece quando a empresa usa mais de um número
    // QR Code. Conexões antigas não contam: quem trocou o WhatsApp oficial
    // pelo QR Code (ou removeu um número) e segue com um só não vê mudança.
    hasMultiple:
      connections.filter((c) => c.provider === "evolution" && !c.archived_at)
        .length > 1,
  };
}
