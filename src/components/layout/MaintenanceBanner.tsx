import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WrenchIcon } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { DEFAULT_MAINTENANCE_MESSAGE } from "../../constants/maintenance";

type MaintenanceSettings = {
  maintenance_enabled: boolean;
  maintenance_message: string | null;
};

const maintenanceQueryKey = ["platform-maintenance"] as const;

const fetchMaintenance = async (): Promise<MaintenanceSettings | null> => {
  const { data, error } = await supabase
    .from("platform_settings")
    .select("maintenance_enabled, maintenance_message")
    .maybeSingle();
  if (error) throw error;
  return data;
};

// Faixa logo abaixo da barra superior, ligada e desligada pelo painel da Unxet
export const MaintenanceBanner = () => {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const userId = authUser?.id ?? null;

  const { data } = useQuery({
    queryKey: maintenanceQueryKey,
    queryFn: fetchMaintenance,
    enabled: !!userId,
    staleTime: 60_000,
    // Rede de segurança caso o Realtime caia
    refetchInterval: 5 * 60_000,
  });

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`platform-maintenance-${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "platform_settings" },
        (payload) => {
          const row = payload.new as MaintenanceSettings;
          queryClient.setQueryData(maintenanceQueryKey, {
            maintenance_enabled: row.maintenance_enabled,
            maintenance_message: row.maintenance_message,
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  if (!userId || !data?.maintenance_enabled) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-900 sm:text-sm"
    >
      <WrenchIcon className="h-4 w-4 shrink-0" aria-hidden />
      <span>{data.maintenance_message || DEFAULT_MAINTENANCE_MESSAGE}</span>
    </div>
  );
};
