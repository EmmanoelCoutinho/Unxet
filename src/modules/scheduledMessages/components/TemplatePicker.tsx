import React, { useState } from "react";
import { ClockIcon, PlusIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import { toast } from "react-toastify";
import { useMetaTemplateActions } from "../hooks/useScheduledMessages";
import type { MetaTemplate, MetaTemplateInput } from "../types/scheduledMessages";
import { TemplateCard } from "./TemplateCard";
import { TemplateFormModal } from "./TemplateFormModal";

/**
 * Escolha do modelo da Meta dentro da campanha. Só os aprovados podem ser
 * escolhidos; os em análise aparecem com o status e a lista se atualiza
 * sozinha (useMetaTemplates). Dá para criar um modelo novo sem sair daqui.
 */
export const TemplatePicker: React.FC<{
  clinicId: string | null;
  templates: MetaTemplate[];
  loading: boolean;
  templateId: string | null;
  onChange: (id: string | null) => void;
  campaignName: string;
}> = ({ clinicId, templates, loading, templateId, onChange, campaignName }) => {
  const { create, sync, creating, syncing } = useMetaTemplateActions(clinicId);
  const [formOpen, setFormOpen] = useState(false);

  // Apagados e desativados só atrapalham a escolha
  const visible = templates.filter((t) => t.status !== "disabled" && t.status !== "archived");
  const approved = visible.filter((t) => t.status === "approved");
  const waiting = visible.filter((t) => t.status === "pending" || t.status === "submitted");

  const handleCreate = async (input: MetaTemplateInput) => {
    try {
      await create(input);
      setFormOpen(false);
      toast.success("Modelo enviado para a Meta. Assim que for aprovado, você pode escolher e continuar.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível enviar o modelo.");
    }
  };

  const handleSync = async () => {
    try {
      const updated = await sync();
      if (updated === 0) toast.info("A Meta ainda não respondeu. Tente de novo em alguns minutos.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível consultar a Meta.");
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3.5 text-blue-900">
        <ShieldCheckIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
        <p className="text-sm leading-6">
          <span className="font-semibold">Pelo WhatsApp oficial, a Meta só deixa iniciar conversa com um modelo aprovado.</span>{" "}
          Escolha um modelo aprovado abaixo ou crie um novo e aguarde a aprovação.
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="block text-sm font-medium text-slate-800">Modelo aprovado pela Meta</p>
        <div className="flex items-center gap-2">
          {waiting.length > 0 && (
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCwIcon className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              Atualizar status
            </button>
          )}
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Criar modelo
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
          <p className="text-sm font-medium text-slate-700">Nenhum modelo ainda</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">
            Crie o modelo com a mensagem da campanha e envie para a Meta. A aprovação costuma levar alguns minutos.
          </p>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            <PlusIcon className="h-4 w-4" />
            Criar modelo
          </button>
        </div>
      ) : (
        <>
          {approved.length === 0 && waiting.length > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              <ClockIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>
                Seu modelo está em análise na Meta. Esta tela se atualiza sozinha: quando ele for aprovado, escolha e
                continue. Você também pode sair e voltar depois.
              </p>
            </div>
          )}
          <div className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {visible.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                selected={template.id === templateId}
                onSelect={() => onChange(template.id)}
              />
            ))}
          </div>
        </>
      )}

      {formOpen && (
        <TemplateFormModal
          initialName={campaignName}
          saving={creating}
          onSubmit={handleCreate}
          onClose={() => setFormOpen(false)}
        />
      )}
    </div>
  );
};
