"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";

type PageItem = { id: string; name: string; access_token?: string };
type IntegrationFlow = "meta" | "whatsapp";

const parseIntegrationState = (rawState: string) => {
  const [clinicId = "", flowMarker = "fb"] = rawState.split("|");
  const flow: IntegrationFlow = flowMarker === "wa" ? "whatsapp" : "meta";
  return { clinicId, flow };
};

export function MetaCallbackPage() {
  const { profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [needsSelection, setNeedsSelection] = useState(false);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [userAccessToken, setUserAccessToken] = useState<string>("");
  const [selectedPageId, setSelectedPageId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );

  const code = params.get("code") ?? "";
  const rawState = params.get("state") ?? "";
  const { clinicId: stateClinicId, flow } = parseIntegrationState(rawState);
  const clinicId = profile?.clinic_id ?? stateClinicId;

  const goBack = () => navigate("/inbox/settings/integrations/meta");

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);

      if (!clinicId) {
        setError("clinicId ausente.");
        setLoading(false);
        return;
      }

      if (!code) {
        setError("code ausente no callback.");
        setLoading(false);
        return;
      }

      if (flow === "whatsapp") {
        const { error: fnErr } = await supabase.functions.invoke(
          "whatsapp-connect",
          {
            body: { clinicId, code },
          },
        );

        if (fnErr) {
          setError("Erro ao conectar o WhatsApp.");
          setLoading(false);
          return;
        }

        navigate("/inbox/settings/integrations/meta");
        return;
      }

      const { data, error: fnErr } = await supabase.functions.invoke(
        "meta-connect",
        {
          body: { action: "exchange_code", clinicId, code },
        },
      );

      if (fnErr) {
        setError("Erro ao trocar o code com a Meta.");
        setLoading(false);
        return;
      }

      const list = Array.isArray(data?.pages) ? data.pages : [];
      const needs = Boolean(data?.needsSelection);
      const token = String(data?.userAccessToken ?? "").trim();

      setPages(list);
      setNeedsSelection(needs);
      setUserAccessToken(token);

      if (!needs) {
        const suggestedPageId = String(data?.suggested?.pageId ?? "").trim();

        if (suggestedPageId && token) {
          const res = await supabase.functions.invoke("meta-connect", {
            body: {
              action: "connect_page",
              clinicId,
              pageId: suggestedPageId,
              userAccessToken: token,
            },
          });

          if (res.error) {
            setError("Erro ao conectar a Página.");
            setLoading(false);
            return;
          }

          navigate("/inbox/settings/integrations/meta");
          return;
        }

        navigate("/inbox/settings/integrations/meta");
        return;
      }

      if (list.length > 0) setSelectedPageId(String(list[0].id));
      setLoading(false);
    };

    run();
  }, [clinicId, code, flow, navigate]);

  const connectSelected = async () => {
    setLoading(true);
    setError(null);

    if (!clinicId) {
      setError("clinicId ausente.");
      setLoading(false);
      return;
    }

    if (!selectedPageId) {
      setError("Selecione uma Página.");
      setLoading(false);
      return;
    }

    if (!userAccessToken) {
      setError("Token de usuário ausente.");
      setLoading(false);
      return;
    }

    const { error: fnErr } = await supabase.functions.invoke("meta-connect", {
      body: {
        action: "connect_page",
        clinicId,
        pageId: selectedPageId,
        userAccessToken,
      },
    });

    if (fnErr) {
      setError("Erro ao conectar a Página.");
      setLoading(false);
      return;
    }

    navigate("/inbox/settings/integrations/meta");
  };

  return (
    <div className="max-w-xl p-4 sm:p-6">
      <h1 className="text-xl font-semibold">
        {flow === "whatsapp" ? "Conectando WhatsApp" : "Conectando Meta"}
      </h1>

      {loading && (
        <div className="mt-4 text-sm text-gray-600">
          {flow === "whatsapp"
            ? "Finalizando conexão do WhatsApp..."
            : "Processando autorização..."}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && flow === "meta" && needsSelection && (
        <div className="mt-6 rounded-lg border p-4">
          <div className="text-sm text-gray-700">
            Escolha a Página do Facebook da sua empresa.
          </div>

          <select
            value={selectedPageId}
            onChange={(e) => setSelectedPageId(e.target.value)}
            className="mt-3 w-full rounded-md border px-3 py-2 text-sm"
          >
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <div className="mt-4 flex gap-2">
            <button
              onClick={connectSelected}
              className="rounded-md bg-black px-4 py-2 text-sm text-white hover:opacity-90"
              disabled={loading}
            >
              Conectar
            </button>
            <button
              onClick={goBack}
              className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
              disabled={loading}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {!loading && !needsSelection && !error && (
        <div className="mt-4 text-sm text-gray-600">
          {flow === "whatsapp" ? "Conexão concluída." : "Finalizando..."}
        </div>
      )}
    </div>
  );
}
