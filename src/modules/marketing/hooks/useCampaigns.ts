import { useCallback, useEffect, useState } from "react";
import { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabaseClient.ts";
import {
  cancelCampaign,
  createCampaign,
  getCampaignById,
  getCampaigns,
  updateCampaign,
} from "../api/campaigns";
import type {
  CampaignWithTemplate,
  CreateCampaignInput,
  UpdateCampaignInput,
} from "../types/campaigns";

type UseCampaignOptions = {
  enabled?: boolean;
};

export const useCampaigns = (
  clinicId: string | null,
  options: UseCampaignOptions = {},
) => {
  const enabled = options.enabled ?? true;
  const [campaigns, setCampaigns] = useState<CampaignWithTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Busca inicial convencional
  const refetch = useCallback(async () => {
    if (!clinicId || !enabled) {
      setCampaigns([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await getCampaigns(clinicId);
      setCampaigns(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Erro ao carregar campanhas.";
      setCampaigns([]);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [clinicId, enabled]);

  // Executa o fetch inicial ao montar o componente ou mudar de clínica
  useEffect(() => {
    refetch();
  }, [refetch]);

  // 💡 Hook do Supabase Realtime com tipagem explícita corrigida
  useEffect(() => {
    if (!clinicId || !enabled) return;

    // Se inscreve nas mudanças da tabela 'campaigns' filtrando pela clínica atual
    const channel = supabase
      .channel(`realtime-campaigns-${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "*", // Escuta INSERT, UPDATE e DELETE
          schema: "public",
          table: "campaigns",
          filter: `clinic_id=eq.${clinicId}`, // Otimização para escutar apenas esta clínica
        },
        (payload: RealtimePostgresChangesPayload<CampaignWithTemplate>) => {
          if (payload.eventType === "INSERT" && payload.new) {
            const newCampaign = payload.new as CampaignWithTemplate;
            setCampaigns((current) => {
              // Evita duplicar se a mutação local já adicionou
              if (current.some((item) => item.id === newCampaign.id)) return current;
              return [newCampaign, ...current];
            });
          } else if (payload.eventType === "UPDATE" && payload.new) {
            const updatedCampaign = payload.new as CampaignWithTemplate;
            setCampaigns((current) =>
              current.map((item) =>
                item.id === updatedCampaign.id ? { ...item, ...updatedCampaign } : item
              )
            );
          } else if (payload.eventType === "DELETE" && payload.old) {
            const deletedId = payload.old.id;
            setCampaigns((current) => current.filter((item) => item.id !== deletedId));
          }
        }
      )
      .subscribe();

    // ⚠️ CLEANUP: Remove o canal WebSocket quando o componente desmontar ou mudar de clínica
    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinicId, enabled]);
  const handleCreateCampaign = useCallback(
    async (input: CreateCampaignInput) => {
      if (!clinicId) throw new Error("Clínica não identificada.");

      setSaving(true);
      try {
        const created = await createCampaign(clinicId, input);
        setCampaigns((current) => {
          if (current.some((item) => item.id === created.id)) return current;
          return [created, ...current];
        });
        return created;
      } finally {
        setSaving(false);
      }
    },
    [clinicId],
  );

  const handleUpdateCampaign = useCallback(
    async (id: string, input: UpdateCampaignInput) => {
      if (!clinicId) throw new Error("Clínica não identificada.");

      setSaving(true);
      try {
        const updated = await updateCampaign(clinicId, id, input);
        setCampaigns((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
        return updated;
      } finally {
        setSaving(false);
      }
    },
    [clinicId],
  );

  const handleCancelCampaign = useCallback(
    async (id: string) => {
      if (!clinicId) throw new Error("Clínica não identificada.");

      setSaving(true);
      try {
        const cancelled = await cancelCampaign(clinicId, id);
        setCampaigns((current) =>
          current.map((item) => (item.id === cancelled.id ? cancelled : item)),
        );
        return cancelled;
      } finally {
        setSaving(false);
      }
    },
    [clinicId],
  );

  return {
    campaigns,
    loading,
    saving,
    error,
    refetch,
    createCampaign: handleCreateCampaign,
    updateCampaign: handleUpdateCampaign,
    cancelCampaign: handleCancelCampaign,
  };
};

// Hook individual para monitorar uma campanha específica com Supabase Realtime integrado por ID
export const useCampaign = (
  clinicId: string | null,
  id: string | null,
  options: UseCampaignOptions = {},
) => {
  const enabled = (options.enabled ?? true) && Boolean(id);
  const [campaign, setCampaign] = useState<CampaignWithTemplate | null>(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!clinicId || !id || !enabled) {
      setCampaign(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await getCampaignById(clinicId, id);
      setCampaign(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Erro ao carregar campanha.";
      setCampaign(null);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [clinicId, enabled, id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // 💡 Realtime individual para atualizar o progresso detalhado na tela de detalhes da campanha
  useEffect(() => {
    if (!clinicId || !id || !enabled) return;

    const channel = supabase
      .channel(`realtime-campaign-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "campaigns",
          filter: `id=eq.${id}`,
        },
        (payload: RealtimePostgresChangesPayload<CampaignWithTemplate>) => {
          if (payload.eventType === "UPDATE" && payload.new) {
            const updated = payload.new as CampaignWithTemplate;
            setCampaign((current) => (current ? { ...current, ...updated } : updated));
          } else if (payload.eventType === "DELETE") {
            setCampaign(null);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinicId, id, enabled]);

  return {
    campaign,
    loading,
    error,
    refetch,
  };
};

export const useCreateCampaign = (clinicId: string | null) => {
  const [saving, setSaving] = useState(false);

  const mutate = useCallback(
    async (input: CreateCampaignInput) => {
      if (!clinicId) throw new Error("Clínica não identificada.");
      setSaving(true);
      try {
        return await createCampaign(clinicId, input);
      } finally {
        setSaving(false);
      }
    },
    [clinicId],
  );

  return { createCampaign: mutate, saving };
};

export const useUpdateCampaign = (clinicId: string | null) => {
  const [saving, setSaving] = useState(false);

  const mutate = useCallback(
    async (id: string, input: UpdateCampaignInput) => {
      if (!clinicId) throw new Error("Clínica não identificada.");
      setSaving(true);
      try {
        return await updateCampaign(clinicId, id, input);
      } finally {
        setSaving(false);
      }
    },
    [clinicId],
  );

  return { updateCampaign: mutate, saving };
};

export const useCancelCampaign = (clinicId: string | null) => {
  const [saving, setSaving] = useState(false);

  const mutate = useCallback(
    async (id: string) => {
      if (!clinicId) throw new Error("Clínica não identificada.");
      setSaving(true);
      try {
        return await cancelCampaign(clinicId, id);
      } finally {
        setSaving(false);
      }
    },
    [clinicId],
  );

  return { cancelCampaign: mutate, saving };
};