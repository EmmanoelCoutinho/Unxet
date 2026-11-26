import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeftIcon,
  BellIcon,
  CalendarDaysIcon,
  ClockIcon,
  PencilIcon,
  PlusIcon,
  StethoscopeIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { useClinic } from "../contexts/ClinicContext";
import { useClinicUserNames } from "../hooks/useClinicUserNames";
import { Button } from "../components/ui/Button";
import { useConfirm } from "../components/ui/ConfirmDialog";
import PreTitleIcon from "../components/ui/PreTitleIcon";
import { Toggle } from "../components/ui/Toggle";
import { FIELD_CLASS, LABEL_CLASS } from "../modules/agenda/components/AgendaModal";
import { ProfessionalModal } from "../modules/agenda/components/ProfessionalModal";
import { ServiceModal } from "../modules/agenda/components/ServiceModal";
import { agendaErrorMessage, DEFAULT_REMINDER_MESSAGE } from "../modules/agenda/api/agenda";
import {
  useAgendaActions,
  useAgendaServices,
  useAgendaSettings,
  useProfessionals,
} from "../modules/agenda/hooks/useAgenda";
import type { AgendaService, AgendaSettings, Professional } from "../modules/agenda/types";
import { WEEKDAY_SHORT, formatDuration } from "../modules/agenda/utils/calendar";
import { TemplateFormModal } from "../modules/scheduledMessages/components/TemplateFormModal";
import {
  useMetaTemplateActions,
  useMetaTemplates,
  useOfficialWhatsapp,
  useQrWhatsappNumbers,
} from "../modules/scheduledMessages/hooks/useScheduledMessages";
import type { MetaTemplateInput } from "../modules/scheduledMessages/types/scheduledMessages";
import { renderTemplatePreview } from "../modules/scheduledMessages/utils/templates";
import { AGENDA_PATH } from "./AgendaPage";

type Tab = "professionals" | "services" | "reminders";

const TABS: { id: Tab; label: string; icon: React.ElementType<{ className?: string }> }[] = [
  { id: "professionals", label: "Profissionais", icon: UsersIcon },
  { id: "services", label: "Serviços", icon: StethoscopeIcon },
  { id: "reminders", label: "Lembretes e regras", icon: BellIcon },
];

/** "Seg a Sex, 08:00–18:00" (resumo curto do expediente) */
const hoursSummary = (p: Professional) => {
  if (p.hours.length === 0) return "Sem horário de trabalho";
  const days = Array.from(new Set(p.hours.map((h) => h.weekday))).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const start = p.hours.reduce((min, h) => (h.start < min ? h.start : min), "23:59");
  const end = p.hours.reduce((max, h) => (h.end > max ? h.end : max), "00:00");
  return `${days.map((d) => WEEKDAY_SHORT[d]).join(", ")} · ${start}–${end}`;
};

export const AgendaSettingsPage: React.FC = () => {
  const { clinicId } = useClinic();
  const [tab, setTab] = useState<Tab>("professionals");
  const { professionals, loading: loadingProfessionals } = useProfessionals(clinicId);
  const { services, loading: loadingServices } = useAgendaServices(clinicId);
  const userNames = useClinicUserNames(clinicId);
  const actions = useAgendaActions(clinicId);
  const confirm = useConfirm();

  const [editingProfessional, setEditingProfessional] = useState<Professional | "new" | null>(null);
  const [editingService, setEditingService] = useState<AgendaService | "new" | null>(null);

  const users = useMemo(
    () =>
      Object.entries(userNames)
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [userNames],
  );
  const serviceName = new Map(services.map((s) => [s.id, s.name]));

  const removeProfessional = async (p: Professional) => {
    const ok = await confirm({
      title: `Remover ${p.name}?`,
      description:
        "Se já tiver agendamentos, o profissional só é desativado e o histórico continua. Se não tiver, é apagado.",
      confirmLabel: "Remover",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const result = await actions.removeProfessional(p.id);
      toast.success(result === "deleted" ? "Profissional apagado." : "Profissional desativado.");
    } catch (err) {
      toast.error(agendaErrorMessage(err, "Não foi possível remover o profissional."));
    }
  };

  const removeService = async (s: AgendaService) => {
    const ok = await confirm({
      title: `Remover ${s.name}?`,
      description: "Se já tiver agendamentos, o serviço só é desativado. Se não tiver, é apagado.",
      confirmLabel: "Remover",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const result = await actions.deleteService(s.id);
      toast.success(result === "deleted" ? "Serviço apagado." : "Serviço desativado.");
    } catch (err) {
      toast.error(agendaErrorMessage(err, "Não foi possível remover o serviço."));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="border-b bg-white px-4 py-5 sm:px-6">
        <Link to={AGENDA_PATH} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeftIcon className="h-4 w-4" />
          Agenda
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <PreTitleIcon icon={CalendarDaysIcon} />
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Profissionais e serviços</h1>
            <p className="mt-1 text-sm text-gray-500">
              O que a equipe e a IA usam para marcar horários.
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-1 overflow-x-auto" role="tablist">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.id)}
                className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  on ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-3xl">
          {tab === "professionals" && (
            <Section
              title="Profissionais"
              description="Quem atende. Cada um tem os próprios horários, folgas e serviços."
              action={
                <Button type="button" onClick={() => setEditingProfessional("new")} className="rounded-full">
                  <span className="flex items-center gap-2">
                    <PlusIcon className="h-4 w-4" />
                    Profissional
                  </span>
                </Button>
              }
            >
              {loadingProfessionals ? (
                <p className="py-6 text-center text-sm text-slate-400">Carregando...</p>
              ) : professionals.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">Nenhum profissional cadastrado ainda.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {professionals.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-3">
                      <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                          {p.name}
                          {p.specialty && <span className="font-normal text-slate-500">{p.specialty}</span>}
                          {!p.active && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                              Desativado
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
                          <ClockIcon className="h-3 w-3 flex-shrink-0" />
                          {hoursSummary(p)}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {p.serviceIds.length === 0
                            ? "Nenhum serviço"
                            : p.serviceIds.map((id) => serviceName.get(id)).filter(Boolean).join(", ")}
                        </p>
                      </div>
                      <IconButton label="Editar" onClick={() => setEditingProfessional(p)} icon={PencilIcon} />
                      <IconButton label="Remover" onClick={() => removeProfessional(p)} icon={Trash2Icon} danger />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {tab === "services" && (
            <Section
              title="Serviços"
              description="O que o cliente marca, com a duração de cada um."
              action={
                <Button type="button" onClick={() => setEditingService("new")} className="rounded-full">
                  <span className="flex items-center gap-2">
                    <PlusIcon className="h-4 w-4" />
                    Serviço
                  </span>
                </Button>
              }
            >
              {loadingServices ? (
                <p className="py-6 text-center text-sm text-slate-400">Carregando...</p>
              ) : services.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">Nenhum serviço cadastrado ainda.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {services.map((s) => {
                    const doers = professionals.filter((p) => p.serviceIds.includes(s.id));
                    return (
                      <li key={s.id} className="flex items-center gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                            {s.name}
                            <span className="font-normal text-slate-500">{formatDuration(s.durationMinutes)}</span>
                            {s.price !== null && (
                              <span className="font-normal text-slate-500">
                                {s.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                              </span>
                            )}
                            {!s.active && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                                Desativado
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {doers.length === 0 ? "Ninguém faz este serviço ainda" : doers.map((p) => p.name).join(", ")}
                          </p>
                        </div>
                        <IconButton label="Editar" onClick={() => setEditingService(s)} icon={PencilIcon} />
                        <IconButton label="Remover" onClick={() => removeService(s)} icon={Trash2Icon} danger />
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          )}

          {tab === "reminders" && <RemindersSection clinicId={clinicId} />}
        </div>
      </div>

      {editingProfessional && (
        <ProfessionalModal
          clinicId={clinicId}
          professional={editingProfessional === "new" ? null : editingProfessional}
          services={services}
          users={users}
          nextPosition={professionals.length}
          usedColors={professionals.map((p) => p.color)}
          onClose={() => setEditingProfessional(null)}
        />
      )}
      {editingService && (
        <ServiceModal
          clinicId={clinicId}
          service={editingService === "new" ? null : editingService}
          professionals={professionals}
          nextPosition={services.length}
          onClose={() => setEditingService(null)}
        />
      )}
    </div>
  );
};

const Section: React.FC<{
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, description, action, children }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{description}</p>
      </div>
      {action}
    </div>
    <div className="mt-3">{children}</div>
  </section>
);

const IconButton: React.FC<{
  label: string;
  onClick: () => void;
  icon: React.ElementType<{ className?: string }>;
  danger?: boolean;
}> = ({ label, onClick, icon: Icon, danger }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className={`rounded-full p-2 text-slate-400 transition ${
      danger ? "hover:bg-red-50 hover:text-red-600" : "hover:bg-slate-100 hover:text-slate-700"
    }`}
  >
    <Icon className="h-4 w-4" />
  </button>
);

const STEP_OPTIONS = [10, 15, 20, 30, 45, 60];
const NOTICE_OPTIONS = [
  { value: 0, label: "Sem antecedência" },
  { value: 30, label: "30 minutos" },
  { value: 60, label: "1 hora" },
  { value: 120, label: "2 horas" },
  { value: 240, label: "4 horas" },
  { value: 720, label: "12 horas" },
  { value: 1440, label: "1 dia" },
  { value: 2880, label: "2 dias" },
];
const AHEAD_OPTIONS = [7, 14, 30, 60, 90, 180];
const REMINDER_OPTIONS = [2, 3, 6, 12, 24, 48, 72];

const REMINDER_VARIABLES = ["{nome}", "{servico}", "{profissional}", "{data}", "{hora}"];

const RemindersSection: React.FC<{ clinicId: string | null }> = ({ clinicId }) => {
  const { settings, loading } = useAgendaSettings(clinicId);
  const actions = useAgendaActions(clinicId);
  const { numbers } = useQrWhatsappNumbers(clinicId);
  const { official } = useOfficialWhatsapp(clinicId);
  const { templates } = useMetaTemplates(clinicId, Boolean(official));
  const templateActions = useMetaTemplateActions(clinicId);
  const [draft, setDraft] = useState<AgendaSettings>(settings);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!loading) setDraft(settings);
  }, [loading, settings]);

  const connections = [
    ...(official ? [{ id: official.id, label: `${official.label} (oficial)`, connected: official.connected, meta: true }] : []),
    ...numbers.map((n) => ({ id: n.id, label: `${n.label} (QR Code)`, connected: n.connected, meta: false })),
  ];
  const connection = connections.find((c) => c.id === draft.reminderConnectionId) ?? null;
  const approvedTemplates = templates.filter(
    (t) => t.status === "approved" && (!t.channelConnectionId || t.channelConnectionId === connection?.id),
  );
  const selectedTemplate = approvedTemplates.find((t) => t.id === draft.reminderTemplateId) ?? null;

  const set = (patch: Partial<AgendaSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const insertVariable = (tag: string) => {
    const el = messageRef.current;
    const text = draft.reminderMessage;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    set({ reminderMessage: text.slice(0, start) + tag + text.slice(end) });
  };

  const save = async () => {
    if (draft.reminderEnabled) {
      if (!connection) return toast.error("Escolha o número por onde o lembrete sai.");
      if (connection.meta && !draft.reminderTemplateId) {
        return toast.error("No WhatsApp oficial, escolha um modelo aprovado pela Meta.");
      }
      if (!connection.meta && !draft.reminderMessage.trim()) return toast.error("Escreva o texto do lembrete.");
    }
    try {
      await actions.saveSettings({
        ...draft,
        reminderTemplateId: connection?.meta ? draft.reminderTemplateId : null,
        reminderMessage: draft.reminderMessage.trim() || DEFAULT_REMINDER_MESSAGE,
      });
      toast.success("Configurações salvas.");
    } catch (err) {
      toast.error(agendaErrorMessage(err, "Não foi possível salvar."));
    }
  };

  const createTemplate = async (input: MetaTemplateInput) => {
    try {
      await templateActions.create(input);
      setCreatingTemplate(false);
      toast.success("Modelo enviado para a Meta. Quando for aprovado, escolha aqui.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível enviar o modelo.");
    }
  };

  if (loading) return <p className="py-6 text-center text-sm text-slate-400">Carregando...</p>;

  return (
    <div className="space-y-4">
      <Section title="Horários que a IA oferece" description="Regras para os horários livres que a IA mostra ao cliente.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="agenda-step" className={LABEL_CLASS}>
              Horários a cada
            </label>
            <select
              id="agenda-step"
              value={draft.slotStepMinutes}
              onChange={(e) => set({ slotStepMinutes: Number(e.target.value) })}
              className={`${FIELD_CLASS} mt-1`}
            >
              {STEP_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {formatDuration(v)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="agenda-notice" className={LABEL_CLASS}>
              Antecedência mínima
            </label>
            <select
              id="agenda-notice"
              value={draft.minNoticeMinutes}
              onChange={(e) => set({ minNoticeMinutes: Number(e.target.value) })}
              className={`${FIELD_CLASS} mt-1`}
            >
              {NOTICE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="agenda-ahead" className={LABEL_CLASS}>
              Até quantos dias
            </label>
            <select
              id="agenda-ahead"
              value={draft.maxDaysAhead}
              onChange={(e) => set({ maxDaysAhead: Number(e.target.value) })}
              className={`${FIELD_CLASS} mt-1`}
            >
              {AHEAD_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v} dias
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Para a IA marcar pelo WhatsApp, ligue "Pode marcar horários na Agenda" na etapa de IA do bot.
        </p>
      </Section>

      <Section title="Lembrete para o cliente" description="Uma mensagem no WhatsApp antes de cada horário marcado.">
        <Toggle
          checked={draft.reminderEnabled}
          onChange={(checked) => set({ reminderEnabled: checked })}
          label="Enviar lembrete"
          helper="Sai pelo número escolhido. Remarcar ou cancelar ajusta o lembrete sozinho. Horário marcado já dentro do prazo do lembrete não recebe."
        />
        {draft.reminderEnabled && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="reminder-hours" className={LABEL_CLASS}>
                  Quando
                </label>
                <select
                  id="reminder-hours"
                  value={draft.reminderHoursBefore}
                  onChange={(e) => set({ reminderHoursBefore: Number(e.target.value) })}
                  className={`${FIELD_CLASS} mt-1`}
                >
                  {(REMINDER_OPTIONS.includes(draft.reminderHoursBefore)
                    ? REMINDER_OPTIONS
                    : [...REMINDER_OPTIONS, draft.reminderHoursBefore].sort((a, b) => a - b)
                  ).map((v) => (
                    <option key={v} value={v}>
                      {v < 24 ? `${v} horas antes` : v === 24 ? "1 dia antes" : `${v / 24} dias antes`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="reminder-connection" className={LABEL_CLASS}>
                  Número do WhatsApp
                </label>
                <select
                  id="reminder-connection"
                  value={draft.reminderConnectionId ?? ""}
                  onChange={(e) => set({ reminderConnectionId: e.target.value || null })}
                  className={`${FIELD_CLASS} mt-1`}
                >
                  <option value="">Escolha</option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                      {c.connected ? "" : " · desconectado"}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {connection?.meta ? (
              <div>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <label htmlFor="reminder-template" className={LABEL_CLASS}>
                    Modelo aprovado pela Meta
                  </label>
                  <button
                    type="button"
                    onClick={() => setCreatingTemplate(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    Criar modelo de lembrete
                  </button>
                </div>
                <select
                  id="reminder-template"
                  value={draft.reminderTemplateId ?? ""}
                  onChange={(e) => set({ reminderTemplateId: e.target.value || null })}
                  className={`${FIELD_CLASS} mt-1`}
                >
                  <option value="">Escolha</option>
                  {approvedTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  Pelo WhatsApp oficial, a Meta só deixa mandar o lembrete com um modelo aprovado. Use {"{data}"},{" "}
                  {"{hora}"}, {"{profissional}"} e {"{servico}"} no texto do modelo.
                </p>
                {selectedTemplate && (
                  <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {renderTemplatePreview(selectedTemplate.body, "Maria")}
                  </p>
                )}
              </div>
            ) : connection ? (
              <div>
                <label htmlFor="reminder-message" className={LABEL_CLASS}>
                  Texto do lembrete
                </label>
                <textarea
                  id="reminder-message"
                  ref={messageRef}
                  rows={4}
                  maxLength={1000}
                  value={draft.reminderMessage}
                  onChange={(e) => set({ reminderMessage: e.target.value })}
                  className={`${FIELD_CLASS} mt-1 resize-y`}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {REMINDER_VARIABLES.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => insertVariable(tag)}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {renderTemplatePreview(draft.reminderMessage, "Maria")}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </Section>

      <div className="flex justify-end">
        <Button type="button" onClick={save} disabled={actions.savingSettings} className="rounded-full">
          {actions.savingSettings ? "Salvando..." : "Salvar configurações"}
        </Button>
      </div>

      {creatingTemplate && (
        <TemplateFormModal
          purpose="agenda"
          initialName="Lembrete de horário"
          saving={templateActions.creating}
          onSubmit={createTemplate}
          onClose={() => setCreatingTemplate(false)}
        />
      )}
    </div>
  );
};

export default AgendaSettingsPage;
