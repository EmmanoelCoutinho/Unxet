import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftIcon, FileTextIcon, PlusIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import { toast } from "react-toastify";
import { useClinic } from "../contexts/ClinicContext";
import { useAuth } from "../contexts/AuthContext";
import { useConfirm } from "../components/ui/ConfirmDialog";
import {
  useMetaTemplateActions,
  useMetaTemplates,
  useOfficialWhatsapp,
} from "../modules/scheduledMessages/hooks/useScheduledMessages";
import { TemplateCard } from "../modules/scheduledMessages/components/TemplateCard";
import { TemplateFormModal } from "../modules/scheduledMessages/components/TemplateFormModal";
import type { MetaTemplate, MetaTemplateInput } from "../modules/scheduledMessages/types/scheduledMessages";
import { CAMPAIGNS_PATH } from "../modules/scheduledMessages/paths";

/**
 * /inbox/campaigns/templates — modelos de mensagem do WhatsApp oficial.
 * Cria, envia para a Meta aprovar e acompanha o status.
 */
export const MetaTemplatesPage: React.FC = () => {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { clinicId, membership, can } = useClinic();
  const { authUser } = useAuth();
  const isAdmin = membership?.role === "admin";
  const canCreate = can("meta_templates.create");

  const { official, loading: loadingOfficial } = useOfficialWhatsapp(clinicId);
  const { templates, loading, error } = useMetaTemplates(clinicId, Boolean(official));
  const { create, sync, remove, creating, syncing } = useMetaTemplateActions(clinicId);
  const [formOpen, setFormOpen] = useState(false);

  const handleCreate = async (input: MetaTemplateInput) => {
    try {
      await create(input);
      setFormOpen(false);
      toast.success("Modelo enviado para a Meta. Ele aparece como aprovado assim que a Meta responder.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível enviar o modelo.");
    }
  };

  const handleSync = async () => {
    try {
      const updated = await sync();
      toast.success(updated > 0 ? "Status atualizado." : "Nenhuma mudança na Meta por enquanto.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível consultar a Meta.");
    }
  };

  const handleDelete = async (template: MetaTemplate) => {
    const ok = await confirm({
      title: `Apagar "${template.name}"?`,
      description:
        "O modelo também é apagado na Meta e não poderá mais ser usado. Campanhas já enviadas continuam no histórico.",
      confirmLabel: "Apagar",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await remove(template.id);
      toast.success("Modelo apagado.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível apagar o modelo.");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate(CAMPAIGNS_PATH)}
                className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                aria-label="Voltar para as campanhas"
              >
                <ArrowLeftIcon className="h-4 w-4" />
              </button>
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">Modelos da Meta</h1>
                <p className="mt-0.5 text-sm text-slate-500">
                  Mensagens aprovadas pela Meta para campanhas pelo WhatsApp oficial
                  {official ? ` (${official.label})` : ""}.
                </p>
              </div>
            </div>
            {official && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={syncing || templates.length === 0}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  <RefreshCwIcon className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                  Atualizar status
                </button>
                {canCreate ? (
                  <button
                    type="button"
                    onClick={() => setFormOpen(true)}
                    className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Novo modelo
                  </button>
                ) : null}
              </div>
            )}
          </div>

          {loadingOfficial || (official && loading) ? (
            <div className="flex justify-center py-16">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            </div>
          ) : !official ? (
            <EmptyState
              title="O WhatsApp oficial não está conectado"
              description="Modelos da Meta só são usados pelo WhatsApp oficial. Pelo QR Code, a campanha sai com o texto que você escrever."
              action={
                isAdmin ? (
                  <button
                    type="button"
                    onClick={() => navigate("/inbox/settings/integrations/meta")}
                    className="mt-4 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    Conectar o WhatsApp oficial
                  </button>
                ) : null
              }
            />
          ) : error ? (
            <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>
          ) : templates.length === 0 ? (
            <EmptyState
              title="Nenhum modelo ainda"
              description="Crie o primeiro modelo e envie para a Meta. Depois de aprovado, ele pode ser usado em quantas campanhas quiser."
              action={
                canCreate ? (
                  <button
                    type="button"
                    onClick={() => setFormOpen(true)}
                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Criar modelo
                  </button>
                ) : null
              }
            />
          ) : (
            <>
              <div className="mt-6 flex gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-blue-900">
                <ShieldCheckIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
                <p className="leading-6">
                  O status é atualizado sozinho enquanto há modelo em análise. Modelos de marketing são cobrados pela
                  Meta a cada mensagem entregue.
                </p>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                {templates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onDelete={
                      isAdmin || template.createdBy === authUser?.id ? () => handleDelete(template) : undefined
                    }
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {formOpen && (
        <TemplateFormModal saving={creating} onSubmit={handleCreate} onClose={() => setFormOpen(false)} />
      )}
    </div>
  );
};

const EmptyState: React.FC<{ title: string; description: string; action?: React.ReactNode }> = ({
  title,
  description,
  action,
}) => (
  <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
      <FileTextIcon className="h-6 w-6" />
    </span>
    <h2 className="mt-4 text-base font-semibold text-slate-900">{title}</h2>
    <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">{description}</p>
    {action}
  </div>
);
