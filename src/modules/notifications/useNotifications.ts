import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

// Avisos do sistema para a pessoa logada (tabela user_notifications). O
// sistema grava; aqui só lê, ouve os novos e marca como lido.
export type UserNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  created_at: string;
  read_at: string | null;
};

const LIMIT = 30;
const COLUMNS = "id, kind, title, body, url, created_at, read_at";

export const useNotifications = (userId: string | null | undefined) => {
  const [items, setItems] = useState<UserNotification[]>([]);

  const load = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    const { data, error } = await supabase
      .from("user_notifications")
      .select(COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    // Banco sem a tabela (migration não aplicada) ou falha de rede: sino vazio
    if (error) return;
    setItems((data ?? []) as UserNotification[]);
  }, [userId]);

  useEffect(() => {
    void load();
    if (!userId) return;
    const channel = supabase
      .channel(`rt:user_notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "user_notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as UserNotification;
          setItems((prev) =>
            prev.some((n) => n.id === row.id) ? prev : [row, ...prev].slice(0, LIMIT),
          );
        },
      )
      .subscribe();
    // Voltou para a aba: pega o que chegou enquanto o tempo real estava parado
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const markRead = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (ids.includes(n.id) && !n.read_at ? { ...n, read_at: now } : n)));
    await supabase.from("user_notifications").update({ read_at: now }).in("id", ids).is("read_at", null);
  }, []);

  return { items, markRead, reload: load };
};
