import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangleIcon, SparklesIcon, XIcon } from "lucide-react";
import { useClinic } from "../../contexts/ClinicContext";
import { AI_ASSISTANT_ENABLED } from "../../lib/aiAssistantFlag";
import { aiAssistantService, aiUsageLevel, currentAiMonth } from "../../services/aiAssistant";

// Recarrega o consumo de tempos em tempos e quando a aba volta ao foco
const REFRESH_MS = 5 * 60 * 1000;

const dismissKey = (month: string) => `unxet:ai-usage-warning-dismissed:${month}`;

const readDismissed = (month: string) => {
  try {
    return window.localStorage.getItem(dismissKey(month)) === "1";
  } catch {
    return false;
  }
};

/**
 * Faixa abaixo da barra superior para quem cuida da IA (admin e cargos com
 * "Assistente com IA"): respostas do mês perto do fim (80%) ou esgotadas.
 * O aviso de 80% pode ser fechado no mês; o de esgotado fica até virar o mês
 * ou a Unxet aumentar o limite.
 */
export const AiUsageBanner = () => {
  const { clinicId, subscription, can } = useClinic();
  const limit = subscription?.ai_replies_addon ?? null;
  const enabled = AI_ASSISTANT_ENABLED && !!clinicId && limit !== null && can("ai.manage");

  const [used, setUsed] = useState<number | null>(null);
  const month = currentAiMonth();
  const [dismissed, setDismissed] = useState(() => readDismissed(month));

  const load = useCallback(() => {
    if (!enabled || !clinicId) return;
    aiAssistantService
      .getRepliesThisMonth(clinicId)
      .then(setUsed)
      // Sem conseguir ler, não mostra nada (o banco segue protegendo o limite)
      .catch(() => setUsed(null));
  }, [enabled, clinicId]);

  useEffect(() => {
    if (!enabled) {
      setUsed(null);
      return;
    }
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, load]);

  if (!enabled || used === null || limit === null) return null;
  const level = aiUsageLevel(used, limit);
  if (level === "ok" || (level === "warning" && dismissed)) return null;

  const exhausted = level === "exhausted";
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(dismissKey(month), "1");
    } catch {
      // sem armazenamento: some só até recarregar
    }
  };

  return (
    <div
      role="status"
      className={[
        "flex shrink-0 items-center justify-center gap-2 border-b px-3 py-2 text-center text-xs font-medium sm:text-sm",
        exhausted
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : "border-amber-200 bg-amber-50 text-amber-900",
      ].join(" ")}
    >
      {exhausted ? (
        <AlertTriangleIcon className="h-4 w-4 shrink-0" aria-hidden />
      ) : (
        <SparklesIcon className="h-4 w-4 shrink-0" aria-hidden />
      )}
      <span>
        {exhausted
          ? "As respostas da IA deste mês acabaram: até o dia 1º, as conversas da etapa de IA vão direto para a equipe."
          : `A IA já usou ${used.toLocaleString("pt-BR")} de ${limit.toLocaleString("pt-BR")} respostas deste mês.`}{" "}
        <Link to="/inbox/ai-assistant" className="font-semibold underline">
          Ver detalhes
        </Link>
      </span>
      {!exhausted ? (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Fechar aviso"
          title="Fechar aviso"
          className="rounded-full p-1 hover:bg-amber-100"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
};
