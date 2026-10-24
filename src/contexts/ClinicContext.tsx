"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "./AuthContext";
import type {
  BillingCycle,
  PlanFeature,
  SubscriptionPlan,
  SubscriptionStatus,
} from "../constants/plans";

type Clinic = {
  id: string;
  name?: string | null;
  slug?: string | null;
  // adicione campos que você tiver na tabela clinics
};

type ClinicMembership = {
  clinic_id: string;
  user_id: string;
  role?: string | null;
  department_id?: string | null;
  // outros campos do clinic_users
};

export type ClinicSubscription = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  current_period_end: string | null;
  billing_cycle: BillingCycle;
  grace_days: number;
  // Adicional "Vários números de WhatsApp": null = desligado (um número só)
  whatsapp_numbers_addon: number | null;
};

// Recarrega o plano de tempos em tempos: suspensão e pagamento aparecem sem
// a pessoa precisar recarregar a página
const SUBSCRIPTION_REFRESH_MS = 10 * 60 * 1000;

type ClinicContextType = {
  clinic: Clinic | null;
  clinicId: string | null;
  membership: ClinicMembership | null;
  // null enquanto carrega ou se a leitura falhar: nada é escondido
  subscription: ClinicSubscription | null;
  hasFeature: (feature: PlanFeature) => boolean;
  loading: boolean;
  error: any;
  refetch: () => Promise<void>;
};

const ClinicContext = createContext<ClinicContextType | undefined>(undefined);

export function ClinicProvider({ children }: { children: React.ReactNode }) {
  const { authUser, loading: authLoading } = useAuth();
  const userId = authUser?.id ?? null;

  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [membership, setMembership] = useState<ClinicMembership | null>(null);
  const [subscription, setSubscription] = useState<ClinicSubscription | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  const clinicId = useMemo(() => membership?.clinic_id ?? null, [membership]);

  // Usuário cujos dados já estão na tela: recarregar para ele acontece em
  // segundo plano, sem trocar a página pelo loading
  const loadedUserIdRef = useRef<string | null>(null);

  const fetchClinic = useCallback(async () => {
    if (!userId) {
      loadedUserIdRef.current = null;
      setClinic(null);
      setMembership(null);
      setSubscription(null);
      setLoading(false);
      return;
    }

    const isBackground = loadedUserIdRef.current === userId;
    if (!isBackground) setLoading(true);
    setError(null);

    // 1) pega membership do usuário
    const { data: membershipRow, error: memErr } = await supabase
      .from("clinic_users")
      .select("clinic_id, user_id, role, department_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (memErr) {
      setError(memErr);
      // Falha (ex.: rede) ao recarregar em segundo plano: mantém o que está na tela
      if (isBackground) return;
      setClinic(null);
      setMembership(null);
      setLoading(false);
      return;
    }

    if (!membershipRow?.clinic_id) {
      setClinic(null);
      setMembership(null);
      setLoading(false);
      return;
    }

    setMembership(membershipRow as ClinicMembership);

    // 2) pega dados da clínica
    const { data: clinicRow, error: clinicErr } = await supabase
      .from("clinics")
      .select("*")
      .eq("id", membershipRow.clinic_id)
      .maybeSingle();

    if (clinicErr) {
      setError(clinicErr);
      if (isBackground) return;
      setClinic(null);
      setLoading(false);
      return;
    }

    setClinic((clinicRow as Clinic) ?? null);

    // 3) plano: o banco trava o que importa, aqui é só o que aparece na tela
    const [{ data: subscriptionRow }, { data: planRows }] = await Promise.all([
      supabase
        .from("clinic_subscriptions")
        .select(
          "plan_code, status, current_period_end, billing_cycle, grace_days, whatsapp_numbers_addon",
        )
        .eq("clinic_id", membershipRow.clinic_id)
        .maybeSingle(),
      supabase.from("subscription_plans").select("*"),
    ]);
    // Empresa sem assinatura vale como Empresarial (mesma regra do banco)
    const planCode = subscriptionRow?.plan_code ?? "empresarial";
    const plan = (planRows as SubscriptionPlan[] | null)?.find(
      (row) => row.code === planCode,
    );
    setSubscription(
      plan
        ? {
            plan,
            status: (subscriptionRow?.status ?? "active") as SubscriptionStatus,
            current_period_end: subscriptionRow?.current_period_end ?? null,
            billing_cycle: (subscriptionRow?.billing_cycle ?? "monthly") as BillingCycle,
            grace_days: subscriptionRow?.grace_days ?? 10,
            whatsapp_numbers_addon:
              subscriptionRow?.whatsapp_numbers_addon ?? null,
          }
        : null,
    );

    loadedUserIdRef.current = userId;
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (authLoading) {
      if (!loadedUserIdRef.current) setLoading(true);
      return;
    }
    fetchClinic();
  }, [authLoading, fetchClinic]);

  useEffect(() => {
    if (!userId) return;
    const timer = window.setInterval(() => {
      if (loadedUserIdRef.current === userId) void fetchClinic();
    }, SUBSCRIPTION_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [userId, fetchClinic]);

  const hasFeature = useCallback(
    (feature: PlanFeature) =>
      !subscription || subscription.plan.features.includes(feature),
    [subscription],
  );

  const value: ClinicContextType = useMemo(
    () => ({
      clinic,
      clinicId,
      membership,
      subscription,
      hasFeature,
      loading,
      error,
      refetch: fetchClinic,
    }),
    [clinic, clinicId, membership, subscription, hasFeature, loading, error, fetchClinic]
  );

  return (
    <ClinicContext.Provider value={value}>{children}</ClinicContext.Provider>
  );
}

export function useClinic() {
  const ctx = useContext(ClinicContext);
  if (!ctx) throw new Error("useClinic must be used within ClinicProvider");
  return ctx;
}
