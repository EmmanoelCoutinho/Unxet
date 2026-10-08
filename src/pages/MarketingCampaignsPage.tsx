import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart3Icon,
  CheckCircle2Icon,
  EyeIcon,
  MegaphoneIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  PlusIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import PreTitleIcon from "../components/ui/PreTitleIcon";
import { useClinic } from "../contexts/ClinicContext";
import {
  useCampaign,
  useCampaigns,
} from "../modules/marketing/hooks/useCampaigns";
import { useCampaignRecipients } from "../modules/marketing/hooks/useCampaignRecipients";
import { useAudiencePreview } from "../modules/marketing/hooks/useAudiencePreview";
import {
  useTemplate,
  useTemplates,
} from "../modules/marketing/hooks/useTemplates";
import type { CampaignWithTemplate } from "../modules/marketing/types/campaigns";
import type { CampaignRecipient } from "../modules/marketing/types/recipients";
import type {
  MessageTemplate,
  MessageTemplateCategory,
  MessageTemplateStatus,
} from "../modules/marketing/types/templates";
import type { ResolveAudienceType } from "../modules/marketing/utils/resolveAudience";

type MarketingTab = "templates" | "campaigns";
type AudienceType = "all" | "tag" | "manual";
type DeliveryMode = "now" | "scheduled";
type CampaignWizardStep = 1 | 2 | 3 | 4 | 5;

type TemplateView = {
  id: string;
  internalName: string;
  metaName: string;
  category: MessageTemplateCategory;
  language: string;
  status: MessageTemplateStatus;
  body: string;
  variablesExample: string;
  footer: string;
  buttons: string[];
  whatsappAccount: string;
  updatedAt: string;
};

type CampaignView = {
  id: string;
  name: string;
  description: string;
  templateId: string;
  audienceType: AudienceType;
  audienceLabel: string;
  status: CampaignWithTemplate["status"];
  sendMode: DeliveryMode;
  sendAt: string;
  totalContacts: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  createdAt: string;
  channelLabel: string;
  template?: TemplateView | null;
  audienceFilters: Record<string, unknown>;
};

type CampaignRecipientView = {
  id: string;
  campaignId: string;
  name: string;
  phone: string;
  status: CampaignRecipient["status"];
  readAt: string | null;
  replied: boolean;
  conversation: string;
  error: string | null;
};

type TemplateFormState = {
  internalName: string;
  metaName: string;
  category: MessageTemplateCategory;
  language: string;
  body: string;
  variablesExample: string;
  footer: string;
  buttonsText: string;
  whatsappAccount: string;
};

type CampaignFormState = {
  name: string;
  description: string;
  channelLabel: string;
  templateId: string;
  audienceType: AudienceType;
  tagLabel: string;
  manualSelection: string;
  sendMode: DeliveryMode;
  scheduledAt: string;
};

type SummaryCardProps = {
  label: string;
  value: string;
  hint: string;
};

type TableActionProps = {
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
};

type ModalShellProps = {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
  widthClassName?: string;
};

const whatsappAccountOptions = ["WhatsApp Principal • +55 11 4000-1000"];

const templateStatusMap: Record<
  MessageTemplateStatus,
  { label: string; className: string }
> = {
  draft: {
    label: "Rascunho",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  },
  submitted: {
    label: "Enviado",
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  pending: {
    label: "Em analise",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  approved: {
    label: "Aprovado",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  rejected: {
    label: "Rejeitado",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
  paused: {
    label: "Pausado",
    className: "border-violet-200 bg-violet-50 text-violet-700",
  },
  disabled: {
    label: "Desativado",
    className: "border-gray-200 bg-gray-100 text-gray-600",
  },
  archived: {
    label: "Arquivado",
    className: "border-stone-200 bg-stone-100 text-stone-700",
  },
};

const templateCategoryMap: Record<MessageTemplateCategory, string> = {
  marketing: "Marketing",
  utility: "Utilidade",
  authentication: "Autenticacao",
};

const campaignStatusMap: Record<
  CampaignWithTemplate["status"],
  { label: string; className: string }
> = {
  draft: {
    label: "Rascunho",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  },
  scheduled: {
    label: "Agendada",
    className: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  sending: {
    label: "Preparada",
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  sent: {
    label: "Concluida",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  partially_failed: {
    label: "Parcialmente falhou",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  failed: {
    label: "Falhou",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
  cancelled: {
    label: "Cancelada",
    className: "border-stone-200 bg-stone-100 text-stone-700",
  },
};

const recipientStatusMap: Record<
  CampaignRecipient["status"],
  { label: string; className: string }
> = {
  pending: {
    label: "Pendente",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  },
  queued: {
    label: "Na fila",
    className: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  sent: {
    label: "Enviado",
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  delivered: {
    label: "Entregue",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  read: {
    label: "Lido",
    className: "border-cyan-200 bg-cyan-50 text-cyan-700",
  },
  replied: {
    label: "Respondeu",
    className: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  },
  failed: {
    label: "Erro",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
  skipped: {
    label: "Ignorado",
    className: "border-stone-200 bg-stone-100 text-stone-700",
  },
};

const normalizeMetaTemplateName = (value: string) => {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, " ")
    .trim()
    .replace(/[\s_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "novo_template";
};

const defaultTemplateForm = (): TemplateFormState => ({
  internalName: "",
  metaName: "",
  category: "marketing",
  language: "pt-BR",
  body: "",
  variablesExample: "",
  footer: "",
  buttonsText: "",
  whatsappAccount: whatsappAccountOptions[0],
});

const defaultCampaignForm = (): CampaignFormState => ({
  name: "",
  description: "",
  channelLabel: whatsappAccountOptions[0],
  templateId: "",
  audienceType: "all",
  tagLabel: "Clientes VIP",
  manualSelection: "",
  sendMode: "now",
  scheduledAt: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
});

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
};

const formatPercent = (value: number) => `${value.toFixed(1)}%`;

const makeRate = (value: number, total: number) =>
  total > 0 ? (value / total) * 100 : 0;

const parseStringList = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) =>
          typeof item === "string"
            ? item.trim()
            : typeof item === "object" && item && "text" in item
              ? String(item.text).trim()
              : String(item ?? "").trim(),
        )
        .filter(Boolean)
    : [];

const formatVariablesExample = (variables: unknown[]) =>
  parseStringList(variables).join("\n");

const mapTemplateToView = (template: MessageTemplate): TemplateView => ({
  id: template.id,
  internalName: template.name,
  metaName:
    template.meta_template_name ?? normalizeMetaTemplateName(template.name),
  category: template.category,
  language: template.language_code,
  status: template.status,
  body: template.body,
  variablesExample: formatVariablesExample(template.variables),
  footer: template.footer ?? "",
  buttons: parseStringList(template.buttons),
  whatsappAccount: template.whatsapp_number_id ?? whatsappAccountOptions[0],
  updatedAt: template.updated_at,
});

const mapDbAudienceTypeToUi = (value: string): AudienceType => {
  if (value === "tag") return "tag";
  if (value === "manual_selection") return "manual";
  return "all";
};

const mapUiAudienceTypeToDb = (value: AudienceType): ResolveAudienceType => {
  if (value === "tag") return "tag";
  if (value === "manual") return "manual_selection";
  return "all_contacts";
};

const buildAudienceLabelFromFilters = (
  audienceType: AudienceType,
  audienceFilters: Record<string, unknown>,
) => {
  if (audienceType === "tag") {
    return `Contatos com tag ${String(audienceFilters.tagLabel ?? "Clientes VIP")}`;
  }

  if (audienceType === "manual") {
    return `Selecao manual • ${String(
      audienceFilters.manualSelection ?? "Lote informado manualmente",
    )}`;
  }

  return "Todos os contatos elegiveis";
};

const mapCampaignToView = (campaign: CampaignWithTemplate): CampaignView => {
  const audienceType = mapDbAudienceTypeToUi(campaign.audience_type);
  const audienceFilters = campaign.audience_filters ?? {};
  const scheduledAt = campaign.scheduled_at;
  const sendMode: DeliveryMode = scheduledAt ? "scheduled" : "now";

  return {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description ?? "",
    templateId: campaign.template_id,
    audienceType,
    audienceLabel:
      String(audienceFilters.audienceLabel ?? "").trim() ||
      buildAudienceLabelFromFilters(audienceType, audienceFilters),
    status: campaign.status,
    sendMode,
    sendAt:
      scheduledAt ??
      campaign.started_at ??
      campaign.finished_at ??
      campaign.updated_at ??
      campaign.created_at,
    totalContacts: campaign.total_contacts,
    delivered: campaign.total_delivered,
    read: campaign.total_read,
    replied: campaign.total_replied,
    failed: campaign.total_failed,
    createdAt: campaign.created_at,
    channelLabel:
      String(campaign.audience_filters?.channelLabel ?? "").trim() ||
      campaign.whatsapp_number_id ||
      whatsappAccountOptions[0],
    template: campaign.template ? mapTemplateToView(campaign.template) : null,
    audienceFilters,
  };
};

const mapRecipientToView = (
  recipient: CampaignRecipient,
): CampaignRecipientView => ({
  id: recipient.id,
  campaignId: recipient.campaign_id,
  name: recipient.contact?.name ?? recipient.phone ?? "Contato sem nome",
  phone: recipient.phone ?? recipient.contact?.phone ?? "—",
  status: recipient.status,
  readAt: recipient.read_at,
  replied: Boolean(recipient.replied_at),
  conversation: recipient.conversation_id
    ? `Conversa ${recipient.conversation_id.slice(0, 8)}`
    : "Sem conversa vinculada",
  error: recipient.error_message,
});

const buildAudienceLabel = (campaignForm: CampaignFormState) => {
  if (campaignForm.audienceType === "tag") {
    return `Contatos com tag ${campaignForm.tagLabel.trim() || "Clientes VIP"}`;
  }

  if (campaignForm.audienceType === "manual") {
    return `Selecao manual • ${
      campaignForm.manualSelection.trim() || "Lote informado manualmente"
    }`;
  }

  return "Todos os contatos elegiveis";
};

const buildAudienceFilters = (campaignForm: CampaignFormState) => ({
  audienceLabel: buildAudienceLabel(campaignForm),
  tagLabel: campaignForm.tagLabel.trim() || null,
  manualSelection: campaignForm.manualSelection.trim() || null,
  channelLabel: campaignForm.channelLabel.trim() || whatsappAccountOptions[0],
});

const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, hint }) => (
  <Card className="rounded-2xl p-5">
    <p className="text-sm font-medium text-slate-500">{label}</p>
    <p className="mt-3 text-3xl font-semibold text-slate-900">{value}</p>
    <p className="mt-2 text-sm text-slate-500">{hint}</p>
  </Card>
);

const StatusBadge = ({
  label,
  className,
}: {
  label: string;
  className: string;
}) => (
  <span
    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}
  >
    {label}
  </span>
);

const TableAction: React.FC<TableActionProps> = ({
  label,
  onClick,
  tone = "default",
  disabled = false,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`text-sm font-medium transition ${
      tone === "danger"
        ? "text-rose-600 hover:text-rose-700"
        : "text-slate-600 hover:text-slate-900"
    } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
  >
    {label}
  </button>
);

const ModalShell: React.FC<ModalShellProps> = ({
  title,
  subtitle,
  onClose,
  children,
  widthClassName = "max-w-5xl",
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
    <div
      className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ${widthClassName}`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 sm:px-6 py-5">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  </div>
);

const Field = ({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) => (
  <label className="block">
    <span className="text-sm font-medium text-slate-800">{label}</span>
    {children}
    {hint ? (
      <span className="mt-2 block text-xs text-slate-500">{hint}</span>
    ) : null}
  </label>
);

const EmptyState = ({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) => (
  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 sm:px-6 py-10 text-center">
    <p className="text-base font-semibold text-slate-900">{title}</p>
    <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-500">
      {description}
    </p>
    {action ? <div className="mt-5">{action}</div> : null}
  </div>
);

const ErrorState = ({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) => (
  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span>{message}</span>
      {onRetry ? (
        <Button type="button" variant="ghost" onClick={onRetry}>
          Tentar novamente
        </Button>
      ) : null}
    </div>
  </div>
);

const TableSkeleton = ({ rows = 4 }: { rows?: number }) => (
  <div className="space-y-3">
    {Array.from({ length: rows }).map((_, index) => (
      <div
        key={index}
        className="h-14 animate-pulse rounded-2xl bg-slate-100"
      />
    ))}
  </div>
);

const inputClassName =
  "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

export const MarketingCampaignsPage: React.FC = () => {
  const { clinicId, loading: clinicLoading } = useClinic();

  const [activeTab, setActiveTab] = useState<MarketingTab>("templates");
  const [templateModalMode, setTemplateModalMode] = useState<
    "create" | "edit" | "view" | null
  >(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [templateForm, setTemplateForm] = useState<TemplateFormState>(
    defaultTemplateForm(),
  );
  const [metaNameManuallyEdited, setMetaNameManuallyEdited] = useState(false);

  const [campaignModalMode, setCampaignModalMode] = useState<
    "create" | "edit" | null
  >(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    null,
  );
  const [campaignStep, setCampaignStep] = useState<CampaignWizardStep>(1);
  const [campaignForm, setCampaignForm] = useState<CampaignFormState>(
    defaultCampaignForm(),
  );
  const [metricsCampaignId, setMetricsCampaignId] = useState<string | null>(
    null,
  );

  const {
    templates: templateRows,
    loading: templatesLoading,
    saving: templatesSaving,
    error: templatesError,
    refetch: refetchTemplates,
    createTemplate,
    updateTemplate,
    archiveTemplate,
  } = useTemplates(clinicId);

  const {
    campaigns: campaignRows,
    loading: campaignsLoading,
    saving: campaignsSaving,
    error: campaignsError,
    refetch: refetchCampaigns,
    createCampaign,
    updateCampaign,
    cancelCampaign,
  } = useCampaigns(clinicId);

  const { template: selectedTemplateDetail, loading: selectedTemplateLoading } =
    useTemplate(clinicId, selectedTemplateId, {
      enabled: templateModalMode === "edit" || templateModalMode === "view",
    });

  const { campaign: selectedCampaignDetail, loading: selectedCampaignLoading } =
    useCampaign(clinicId, selectedCampaignId, {
      enabled: campaignModalMode === "edit",
    });

  const { campaign: metricsCampaignRow, loading: metricsCampaignLoading } =
    useCampaign(clinicId, metricsCampaignId, {
      enabled: Boolean(metricsCampaignId),
    });

  const {
    recipients: metricsRecipientRows,
    loading: metricsRecipientsLoading,
    error: metricsRecipientsError,
    refetch: refetchMetricsRecipients,
  } = useCampaignRecipients(clinicId, metricsCampaignId, {
    enabled: Boolean(metricsCampaignId),
  });

  const templates = useMemo(
    () => templateRows.map(mapTemplateToView),
    [templateRows],
  );
  const campaigns = useMemo(
    () => campaignRows.map(mapCampaignToView),
    [campaignRows],
  );
  const metricsCampaign = useMemo(
    () => (metricsCampaignRow ? mapCampaignToView(metricsCampaignRow) : null),
    [metricsCampaignRow],
  );
  const metricsRecipients = useMemo(
    () => metricsRecipientRows.map(mapRecipientToView),
    [metricsRecipientRows],
  );

  const approvedTemplates = useMemo(
    () => templates.filter((item) => item.status === "approved"),
    [templates],
  );

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );

  const selectedCampaign = useMemo(
    () => campaigns.find((item) => item.id === selectedCampaignId) ?? null,
    [campaigns, selectedCampaignId],
  );

  const selectedCampaignTemplate = useMemo(
    () =>
      approvedTemplates.find((item) => item.id === campaignForm.templateId) ??
      null,
    [approvedTemplates, campaignForm.templateId],
  );

  const templateSummary = useMemo(() => {
    const approved = templates.filter(
      (item) => item.status === "approved",
    ).length;
    const pending = templates.filter(
      (item) => item.status === "pending" || item.status === "submitted",
    ).length;
    const rejected = templates.filter(
      (item) => item.status === "rejected",
    ).length;

    return {
      total: templates.length,
      approved,
      pending,
      rejected,
    };
  }, [templates]);

  const campaignSummary = useMemo(() => {
    const active = campaigns.filter((item) => item.status === "sending").length;
    const scheduled = campaigns.filter(
      (item) => item.status === "scheduled",
    ).length;
    const sent = campaigns.filter((item) => item.status === "sent").length;
    const replies = campaigns.reduce((total, item) => total + item.replied, 0);

    return {
      active,
      scheduled,
      sent,
      replies,
    };
  }, [campaigns]);

  const audiencePreview = useAudiencePreview(
    clinicId,
    {
      audienceType: mapUiAudienceTypeToDb(campaignForm.audienceType),
      audienceFilters: buildAudienceFilters(campaignForm),
    },
    { enabled: Boolean(campaignModalMode) && Boolean(clinicId) },
  );

  useEffect(() => {
    if (!templateModalMode || !selectedTemplateDetail) return;
    const template = mapTemplateToView(selectedTemplateDetail);

    setTemplateForm({
      internalName: template.internalName,
      metaName: template.metaName,
      category: template.category,
      language: template.language,
      body: template.body,
      variablesExample: template.variablesExample,
      footer: template.footer,
      buttonsText: template.buttons.join("\n"),
      whatsappAccount: template.whatsappAccount,
    });
    setMetaNameManuallyEdited(true);
  }, [selectedTemplateDetail, templateModalMode]);

  useEffect(() => {
    if (campaignModalMode !== "edit" || !selectedCampaignDetail) return;
    const campaign = mapCampaignToView(selectedCampaignDetail);

    setCampaignForm({
      name: campaign.name,
      description: campaign.description,
      channelLabel: campaign.channelLabel,
      templateId: campaign.templateId,
      audienceType: campaign.audienceType,
      tagLabel: String(campaign.audienceFilters.tagLabel ?? "Clientes VIP"),
      manualSelection: String(campaign.audienceFilters.manualSelection ?? ""),
      sendMode: campaign.sendMode,
      scheduledAt:
        campaign.sendMode === "scheduled"
          ? campaign.sendAt.slice(0, 16)
          : defaultCampaignForm().scheduledAt,
    });
    setCampaignStep(1);
  }, [campaignModalMode, selectedCampaignDetail]);

  const resetTemplateForm = () => {
    setTemplateForm(defaultTemplateForm());
    setSelectedTemplateId(null);
    setTemplateModalMode(null);
    setMetaNameManuallyEdited(false);
  };

  const resetCampaignForm = () => {
    setCampaignForm(defaultCampaignForm());
    setSelectedCampaignId(null);
    setCampaignModalMode(null);
    setCampaignStep(1);
  };

  const openTemplateModal = (
    mode: "create" | "edit" | "view",
    template?: TemplateView,
  ) => {
    if (template) {
      setSelectedTemplateId(template.id);
      setTemplateForm({
        internalName: template.internalName,
        metaName: template.metaName,
        category: template.category,
        language: template.language,
        body: template.body,
        variablesExample: template.variablesExample,
        footer: template.footer,
        buttonsText: template.buttons.join("\n"),
        whatsappAccount: template.whatsappAccount,
      });
      setMetaNameManuallyEdited(true);
    } else {
      setSelectedTemplateId(null);
      setTemplateForm(defaultTemplateForm());
      setMetaNameManuallyEdited(false);
    }

    setTemplateModalMode(mode);
  };

  const openCampaignModal = (
    mode: "create" | "edit",
    campaign?: CampaignView,
  ) => {
    if (campaign) {
      setSelectedCampaignId(campaign.id);
      setCampaignForm({
        name: campaign.name,
        description: campaign.description,
        channelLabel: campaign.channelLabel,
        templateId: campaign.templateId,
        audienceType: campaign.audienceType,
        tagLabel: String(campaign.audienceFilters.tagLabel ?? "Clientes VIP"),
        manualSelection: String(campaign.audienceFilters.manualSelection ?? ""),
        sendMode: campaign.sendMode,
        scheduledAt:
          campaign.sendMode === "scheduled"
            ? campaign.sendAt.slice(0, 16)
            : defaultCampaignForm().scheduledAt,
      });
    } else {
      setSelectedCampaignId(null);
      setCampaignForm({
        ...defaultCampaignForm(),
        templateId: approvedTemplates[0]?.id ?? "",
      });
    }

    setCampaignStep(1);
    setCampaignModalMode(mode);
  };

  const handleTemplateFieldChange = <K extends keyof TemplateFormState>(
    field: K,
    value: TemplateFormState[K],
  ) => {
    setTemplateForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleCampaignFieldChange = <K extends keyof CampaignFormState>(
    field: K,
    value: CampaignFormState[K],
  ) => {
    setCampaignForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleSaveTemplate = async () => {
    if (!clinicId) {
      toast.error("Clinica não identificada.");
      return;
    }

    const payload = {
      whatsapp_number_id: templateForm.whatsappAccount.trim() || null,
      name: templateForm.internalName.trim() || "Novo template",
      meta_template_name: normalizeMetaTemplateName(
        templateForm.metaName.trim() || templateForm.internalName.trim(),
      ),
      category: templateForm.category,
      language_code: templateForm.language,
      body: templateForm.body.trim(),
      variables: templateForm.variablesExample
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
      footer: templateForm.footer.trim() || null,
      buttons: templateForm.buttonsText
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
      status:
        templateModalMode === "edit" && selectedTemplate
          ? selectedTemplate.status
          : ("draft" as const),
    };

    try {
      if (templateModalMode === "edit" && selectedTemplateId) {
        await updateTemplate(selectedTemplateId, payload);
        toast.success("Template atualizado com sucesso.");
      } else {
        await createTemplate(payload);
        toast.success("Template criado com sucesso.");
      }

      resetTemplateForm();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Não foi possivel salvar o template.",
      );
    }
  };

  const handleTemplateAction = async (
    action: "submit" | "duplicate" | "archive",
    template: TemplateView,
  ) => {
    try {
      if (action === "submit") {
        await updateTemplate(template.id, {
          status: "submitted",
        });
        toast.success("Template enviado para revisao interna.");
        return;
      }

      if (action === "archive") {
        await archiveTemplate(template.id);
        toast.success("Template arquivado.");
        return;
      }

      await createTemplate({
        whatsapp_number_id: template.whatsappAccount,
        name: `${template.internalName} • Copia`,
        meta_template_name: `${template.metaName}_copia`,
        category: template.category,
        language_code: template.language,
        body: template.body,
        variables: template.variablesExample
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
        footer: template.footer || null,
        buttons: template.buttons,
        status: "draft",
      });
      toast.success("Copia do template criada.");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Não foi possivel concluir a acao.",
      );
    }
  };

  const handleSaveCampaign = async () => {
    if (!clinicId) {
      toast.error("Clinica não identificada.");
      return;
    }

    const template = approvedTemplates.find(
      (item) => item.id === campaignForm.templateId,
    );

    if (!template) {
      toast.error("Selecione um template aprovado para continuar.");
      return;
    }

    const isScheduled = campaignForm.sendMode === "scheduled";
    const scheduledAt =
      isScheduled && campaignForm.scheduledAt
        ? new Date(campaignForm.scheduledAt).toISOString()
        : null;

    const payload = {
      template_id: template.id,
      whatsapp_number_id: campaignForm.channelLabel.trim() || null,
      name: campaignForm.name.trim() || "Nova campanha",
      description: campaignForm.description.trim() || null,
      status: isScheduled ? ("scheduled" as const) : ("sending" as const),
      audience_type: mapUiAudienceTypeToDb(campaignForm.audienceType),
      audience_filters: buildAudienceFilters(campaignForm),
      scheduled_at: scheduledAt,
      started_at: isScheduled ? null : new Date().toISOString(),
      finished_at: null,
    };

    try {
      if (campaignModalMode === "edit" && selectedCampaignId) {
        await updateCampaign(selectedCampaignId, payload);
        toast.success("Campanha atualizada com sucesso.");
      } else {
        await createCampaign(payload);
        toast.success("Campanha criada e destinatarios gerados.");
      }

      resetCampaignForm();
      setActiveTab("campaigns");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Não foi possivel salvar a campanha.",
      );
    }
  };

  const handleDuplicateCampaign = async (campaign: CampaignView) => {
    try {
      await createCampaign({
        template_id: campaign.templateId,
        whatsapp_number_id: campaign.channelLabel,
        name: `${campaign.name} • Copia`,
        description: campaign.description || null,
        status: "draft",
        audience_type: mapUiAudienceTypeToDb(campaign.audienceType),
        audience_filters: {
          ...campaign.audienceFilters,
          audienceLabel: campaign.audienceLabel,
          channelLabel: campaign.channelLabel,
        },
        scheduled_at: null,
        started_at: null,
        finished_at: null,
      });
      toast.success("Copia da campanha criada.");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Não foi possivel duplicar a campanha.",
      );
    }
  };

  const handleCancelCampaign = async (campaignId: string) => {
    try {
      await cancelCampaign(campaignId);
      toast.success("Campanha cancelada.");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Não foi possivel cancelar a campanha.",
      );
    }
  };

  const canAdvanceCampaignStep = () => {
    if (campaignStep === 1) {
      return campaignForm.name.trim().length > 0;
    }

    if (campaignStep === 2) {
      return campaignForm.templateId.length > 0;
    }

    if (campaignStep === 3) {
      return (
        campaignForm.audienceType !== "manual" ||
        campaignForm.manualSelection.trim().length > 0
      );
    }

    if (campaignStep === 4) {
      return (
        campaignForm.sendMode !== "scheduled" ||
        campaignForm.scheduledAt.trim().length > 0
      );
    }

    return true;
  };

  if (clinicLoading) {
    return (
      <div className="flex h-full flex-col bg-slate-50 px-4 sm:px-8 py-6 sm:py-8">
        <TableSkeleton rows={6} />
      </div>
    );
  }

  if (!clinicId) {
    return (
      <div className="flex h-full flex-col bg-slate-50 px-4 sm:px-8 py-6 sm:py-8">
        <EmptyState
          title="Clinica não identificada"
          description="Aguarde o carregamento da clinica atual para gerenciar templates e campanhas."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="border-b bg-white px-4 sm:px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <PreTitleIcon icon={MegaphoneIcon} />
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                Marketing / Campanhas
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Campanhas com modelos aprovados pela Meta, publicos segmentados
                e metricas de entrega, leitura e respostas.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {[
            { key: "templates" as const, label: "Templates" },
            { key: "campaigns" as const, label: "Campanhas" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                activeTab === tab.key
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
        {activeTab === "templates" ? (
          <div className="space-y-6 pb-10">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="Total de templates"
                value={String(templateSummary.total)}
                hint="Biblioteca ativa da operacao."
              />
              <SummaryCard
                label="Aprovados"
                value={String(templateSummary.approved)}
                hint="Prontos para uso em campanhas."
              />
              <SummaryCard
                label="Em analise"
                value={String(templateSummary.pending)}
                hint="Aguardando validacao."
              />
              <SummaryCard
                label="Rejeitados"
                value={String(templateSummary.rejected)}
                hint="Precisam de revisao."
              />
            </div>

            <Card className="rounded-3xl p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Campanhas com modelos aprovados pela Meta
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Organize os modelos por categoria, idioma e conta vinculada
                    antes de publicar em producao.
                  </p>
                </div>

                <Button
                  type="button"
                  onClick={() => openTemplateModal("create")}
                  className="rounded-full"
                >
                  <span className="flex items-center gap-2">
                    <PlusIcon className="h-4 w-4" />
                    Criar template
                  </span>
                </Button>
              </div>

              <div className="mt-6">
                {templatesError ? (
                  <ErrorState
                    message={templatesError}
                    onRetry={refetchTemplates}
                  />
                ) : templatesLoading ? (
                  <TableSkeleton />
                ) : templates.length === 0 ? (
                  <EmptyState
                    title="Nenhum template cadastrado"
                    description="Crie o primeiro template para estruturar sua base de campanhas."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                      <thead>
                        <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <th className="pb-3 pr-4">Nome</th>
                          <th className="pb-3 pr-4">Categoria</th>
                          <th className="pb-3 pr-4">Idioma</th>
                          <th className="pb-3 pr-4">Status</th>
                          <th className="pb-3 pr-4">Ultima atualizacao</th>
                          <th className="pb-3">Acoes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {templates.map((template) => (
                          <tr key={template.id} className="align-top">
                            <td className="py-4 pr-4">
                              <div>
                                <p className="font-medium text-slate-900">
                                  {template.internalName}
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                  Meta: {template.metaName}
                                </p>
                              </div>
                            </td>
                            <td className="py-4 pr-4 text-sm text-slate-600">
                              {templateCategoryMap[template.category]}
                            </td>
                            <td className="py-4 pr-4 text-sm text-slate-600">
                              {template.language}
                            </td>
                            <td className="py-4 pr-4">
                              <StatusBadge
                                {...templateStatusMap[template.status]}
                              />
                            </td>
                            <td className="py-4 pr-4 text-sm text-slate-600">
                              {formatDateTime(template.updatedAt)}
                            </td>
                            <td className="py-4">
                              <div className="flex min-w-[320px] flex-wrap gap-x-4 gap-y-2">
                                <TableAction
                                  label="Visualizar"
                                  onClick={() =>
                                    openTemplateModal("view", template)
                                  }
                                />
                                <TableAction
                                  label="Editar"
                                  onClick={() =>
                                    openTemplateModal("edit", template)
                                  }
                                />
                                <TableAction
                                  label="Enviar para Meta"
                                  onClick={() =>
                                    handleTemplateAction("submit", template)
                                  }
                                  disabled={
                                    templatesSaving ||
                                    template.status === "approved" ||
                                    template.status === "pending" ||
                                    template.status === "submitted" ||
                                    template.status === "archived"
                                  }
                                />
                                <TableAction
                                  label="Duplicar"
                                  onClick={() =>
                                    handleTemplateAction("duplicate", template)
                                  }
                                  disabled={templatesSaving}
                                />
                                <TableAction
                                  label="Arquivar"
                                  onClick={() =>
                                    handleTemplateAction("archive", template)
                                  }
                                  disabled={
                                    templatesSaving ||
                                    template.status === "archived"
                                  }
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Card>
          </div>
        ) : (
          <div className="space-y-6 pb-10">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="Campanhas ativas"
                value={String(campaignSummary.active)}
                hint="Preparadas nesta operacao."
              />
              <SummaryCard
                label="Agendadas"
                value={String(campaignSummary.scheduled)}
                hint="Prontas para a proxima janela."
              />
              <SummaryCard
                label="Concluidas"
                value={String(campaignSummary.sent)}
                hint="Historico recente de campanhas."
              />
              <SummaryCard
                label="Respostas geradas"
                value={String(campaignSummary.replies)}
                hint="Conversas iniciadas pelas campanhas."
              />
            </div>

            <Card className="rounded-3xl p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Envie mensagens para publicos segmentados
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Selecione apenas templates aprovados e acompanhe entrega,
                    leitura e respostas.
                  </p>
                </div>

                <Button
                  type="button"
                  onClick={() => openCampaignModal("create")}
                  disabled={approvedTemplates.length === 0}
                  className="rounded-full"
                >
                  <span className="flex items-center gap-2">
                    <PlusIcon className="h-4 w-4" />
                    Criar campanha
                  </span>
                </Button>
              </div>

              {approvedTemplates.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Nenhum template aprovado esta disponivel no momento. Crie ou
                  aprove um modelo antes de montar a campanha.
                </div>
              ) : null}

              <div className="mt-6">
                {campaignsError ? (
                  <ErrorState
                    message={campaignsError}
                    onRetry={refetchCampaigns}
                  />
                ) : campaignsLoading ? (
                  <TableSkeleton />
                ) : campaigns.length === 0 ? (
                  <EmptyState
                    title="Nenhuma campanha criada"
                    description="Assim que uma campanha for criada, os destinatarios serao gerados automaticamente e as metricas passarao a refletir os dados do banco."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-[1200px] divide-y divide-slate-200">
                      <thead>
                        <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <th className="pb-3 pr-4">Nome</th>
                          <th className="pb-3 pr-4">Template usado</th>
                          <th className="pb-3 pr-4">Publico</th>
                          <th className="pb-3 pr-4">Status</th>
                          <th className="pb-3 pr-4">Envio</th>
                          <th className="pb-3 pr-4">Total</th>
                          <th className="pb-3 pr-4">Entregues</th>
                          <th className="pb-3 pr-4">Lidas</th>
                          <th className="pb-3 pr-4">Respostas</th>
                          <th className="pb-3">Acoes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {campaigns.map((campaign) => {
                          const canCancel =
                            campaign.status === "draft" ||
                            campaign.status === "scheduled" ||
                            campaign.status === "sending";

                          return (
                            <tr key={campaign.id} className="align-top">
                              <td className="py-4 pr-4">
                                <div>
                                  <p className="font-medium text-slate-900">
                                    {campaign.name}
                                  </p>
                                  <p className="mt-1 text-sm text-slate-500">
                                    {campaign.channelLabel}
                                  </p>
                                </div>
                              </td>
                              <td className="py-4 pr-4 text-sm text-slate-600">
                                {campaign.template?.internalName ??
                                  "Template removido"}
                              </td>
                              <td className="py-4 pr-4 text-sm text-slate-600">
                                {campaign.audienceLabel}
                              </td>
                              <td className="py-4 pr-4">
                                <StatusBadge
                                  {...campaignStatusMap[campaign.status]}
                                />
                              </td>
                              <td className="py-4 pr-4 text-sm text-slate-600">
                                {formatDateTime(campaign.sendAt)}
                              </td>
                              <td className="py-4 pr-4 text-sm text-slate-600">
                                {campaign.totalContacts}
                              </td>
                              <td className="py-4 pr-4 text-sm text-slate-600">
                                {campaign.delivered}
                              </td>
                              <td className="py-4 pr-4 text-sm text-slate-600">
                                {campaign.read}
                              </td>
                              <td className="py-4 pr-4 text-sm text-slate-600">
                                {campaign.replied}
                              </td>
                              <td className="py-4">
                                <div className="flex min-w-[290px] flex-wrap gap-x-4 gap-y-2">
                                  <TableAction
                                    label="Ver metricas"
                                    onClick={() =>
                                      setMetricsCampaignId(campaign.id)
                                    }
                                  />
                                  <TableAction
                                    label="Editar"
                                    onClick={() =>
                                      openCampaignModal("edit", campaign)
                                    }
                                  />
                                  <TableAction
                                    label="Duplicar"
                                    onClick={() =>
                                      handleDuplicateCampaign(campaign)
                                    }
                                    disabled={campaignsSaving}
                                  />
                                  <TableAction
                                    label="Cancelar"
                                    onClick={() =>
                                      handleCancelCampaign(campaign.id)
                                    }
                                    tone="danger"
                                    disabled={!canCancel || campaignsSaving}
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>

      {templateModalMode ? (
        <ModalShell
          title={
            templateModalMode === "create"
              ? "Criar template"
              : templateModalMode === "edit"
                ? "Editar template"
                : "Visualizar template"
          }
          subtitle="Estruture o modelo com os campos usados pela operacao e mantenha o conteudo pronto para revisao."
          onClose={resetTemplateForm}
          widthClassName="max-w-4xl"
        >
          <div className="grid gap-6 px-4 sm:px-6 py-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              {selectedTemplateId && selectedTemplateLoading ? (
                <TableSkeleton rows={3} />
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Nome interno">
                  <input
                    value={templateForm.internalName}
                    onChange={(event) => {
                      const nextInternalName = event.target.value;
                      const previousGenerated = normalizeMetaTemplateName(
                        templateForm.internalName,
                      );

                      handleTemplateFieldChange(
                        "internalName",
                        nextInternalName,
                      );

                      if (
                        !metaNameManuallyEdited ||
                        templateForm.metaName.trim() === "" ||
                        templateForm.metaName === previousGenerated
                      ) {
                        handleTemplateFieldChange(
                          "metaName",
                          normalizeMetaTemplateName(nextInternalName),
                        );
                        setMetaNameManuallyEdited(false);
                      }
                    }}
                    disabled={templateModalMode === "view"}
                    className={inputClassName}
                    placeholder="Ex: Reativacao carteira premium"
                  />
                </Field>
                <Field label="Nome do template na Meta">
                  <input
                    value={templateForm.metaName}
                    onChange={(event) => {
                      handleTemplateFieldChange("metaName", event.target.value);
                      setMetaNameManuallyEdited(true);
                    }}
                    disabled={templateModalMode === "view"}
                    className={inputClassName}
                    placeholder="Ex: reativacao_carteira_premium"
                  />
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Categoria">
                  <select
                    value={templateForm.category}
                    onChange={(event) =>
                      handleTemplateFieldChange(
                        "category",
                        event.target.value as MessageTemplateCategory,
                      )
                    }
                    disabled={templateModalMode === "view"}
                    className={inputClassName}
                  >
                    {Object.entries(templateCategoryMap).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </Field>
                <Field label="Idioma">
                  <input
                    value={templateForm.language}
                    disabled
                    readOnly
                    className={inputClassName}
                  />
                </Field>
                <Field label="Numero/conta vinculada">
                  <select
                    value={templateForm.whatsappAccount}
                    onChange={(event) =>
                      handleTemplateFieldChange(
                        "whatsappAccount",
                        event.target.value,
                      )
                    }
                    disabled={
                      templateModalMode === "view" ||
                      whatsappAccountOptions.length <= 1
                    }
                    className={inputClassName}
                  >
                    {whatsappAccountOptions.map((account) => (
                      <option key={account} value={account}>
                        {account}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Corpo da mensagem">
                <textarea
                  value={templateForm.body}
                  onChange={(event) =>
                    handleTemplateFieldChange("body", event.target.value)
                  }
                  disabled={templateModalMode === "view"}
                  rows={7}
                  className={inputClassName}
                  placeholder="Escreva a mensagem principal do template."
                />
              </Field>

              <Field
                label="Variaveis/exemplos"
                hint="Exemplo: {{1}} = Nome do contato | {{2}} = Data agendada"
              >
                <textarea
                  value={templateForm.variablesExample}
                  onChange={(event) =>
                    handleTemplateFieldChange(
                      "variablesExample",
                      event.target.value,
                    )
                  }
                  disabled={templateModalMode === "view"}
                  rows={3}
                  className={inputClassName}
                  placeholder="Descreva o uso das variaveis para revisao interna."
                />
              </Field>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Rodape opcional">
                  <textarea
                    value={templateForm.footer}
                    onChange={(event) =>
                      handleTemplateFieldChange("footer", event.target.value)
                    }
                    disabled={templateModalMode === "view"}
                    rows={3}
                    className={inputClassName}
                    placeholder="Texto complementar opcional."
                  />
                </Field>
                <Field
                  label="Botoes opcionais"
                  hint="Use uma linha por botao. Exemplo: Falar com consultor"
                >
                  <textarea
                    value={templateForm.buttonsText}
                    onChange={(event) =>
                      handleTemplateFieldChange(
                        "buttonsText",
                        event.target.value,
                      )
                    }
                    disabled={templateModalMode === "view"}
                    rows={3}
                    className={inputClassName}
                    placeholder="Adicionar CTA opcional"
                  />
                </Field>
              </div>
            </div>

            <Card className="h-fit rounded-3xl border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center gap-2">
                <EyeIcon className="h-4 w-4 text-slate-500" />
                <h3 className="font-semibold text-slate-900">Preview</h3>
              </div>
              <div className="mt-4 rounded-[28px] bg-[#0f172a] p-3">
                <div className="rounded-[24px] bg-white p-4 shadow-sm">
                  <p className="text-sm font-semibold text-slate-900">
                    {templateForm.internalName || "Novo template"}
                  </p>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {templateForm.body ||
                      "A previa da mensagem aparecera aqui conforme os campos forem preenchidos."}
                  </p>
                  {templateForm.footer ? (
                    <p className="mt-3 text-xs text-slate-400">
                      {templateForm.footer}
                    </p>
                  ) : null}
                  {templateForm.buttonsText.trim() ? (
                    <div className="mt-4 space-y-2">
                      {templateForm.buttonsText
                        .split("\n")
                        .map((item) => item.trim())
                        .filter(Boolean)
                        .map((item) => (
                          <button
                            key={item}
                            type="button"
                            className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-blue-600"
                          >
                            {item}
                          </button>
                        ))}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 space-y-3 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <CheckCircle2Icon className="h-4 w-4 text-emerald-600" />
                  Conteudo pronto para revisao antes de qualquer integracao
                  externa.
                </div>
              </div>
            </Card>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-4 sm:px-6 py-4">
            <Button type="button" variant="ghost" onClick={resetTemplateForm}>
              Fechar
            </Button>
            {templateModalMode !== "view" ? (
              <Button
                type="button"
                onClick={handleSaveTemplate}
                className="rounded-full"
                disabled={templatesSaving}
              >
                {templateModalMode === "edit"
                  ? "Salvar alteracoes"
                  : "Criar template"}
              </Button>
            ) : null}
          </div>
        </ModalShell>
      ) : null}

      {campaignModalMode ? (
        <ModalShell
          title={
            campaignModalMode === "create"
              ? "Criar campanha"
              : "Editar campanha"
          }
          subtitle="Monte uma campanha em etapas simples usando apenas modelos aprovados pela Meta."
          onClose={resetCampaignForm}
          widthClassName="max-w-5xl"
        >
          <div className="border-b border-slate-200 px-4 sm:px-6 py-4">
            <div className="flex flex-wrap gap-2">
              {[
                { step: 1 as CampaignWizardStep, label: "Informacoes" },
                { step: 2 as CampaignWizardStep, label: "Template" },
                { step: 3 as CampaignWizardStep, label: "Publico" },
                { step: 4 as CampaignWizardStep, label: "Agendamento" },
                { step: 5 as CampaignWizardStep, label: "Revisao" },
              ].map((item) => (
                <div
                  key={item.step}
                  className={`rounded-full px-3 py-2 text-sm font-medium ${
                    campaignStep === item.step
                      ? "bg-blue-600 text-white"
                      : campaignStep > item.step
                        ? "bg-blue-50 text-blue-700"
                        : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {item.step}. {item.label}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-6 px-4 sm:px-6 py-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-5">
              {selectedCampaignId && selectedCampaignLoading ? (
                <TableSkeleton rows={3} />
              ) : null}

              {campaignStep === 1 ? (
                <>
                  <Field label="Nome da campanha">
                    <input
                      value={campaignForm.name}
                      onChange={(event) =>
                        handleCampaignFieldChange("name", event.target.value)
                      }
                      className={inputClassName}
                      placeholder="Ex: Reengajamento carteira ativa"
                    />
                  </Field>
                  <Field label="Descricao interna opcional">
                    <textarea
                      value={campaignForm.description}
                      onChange={(event) =>
                        handleCampaignFieldChange(
                          "description",
                          event.target.value,
                        )
                      }
                      rows={4}
                      className={inputClassName}
                      placeholder="Contexto interno para a equipe acompanhar o objetivo da campanha."
                    />
                  </Field>
                  <Field label="Numero/canal de envio">
                    <input
                      value={campaignForm.channelLabel}
                      onChange={(event) =>
                        handleCampaignFieldChange(
                          "channelLabel",
                          event.target.value,
                        )
                      }
                      className={inputClassName}
                    />
                  </Field>
                </>
              ) : null}

              {campaignStep === 2 ? (
                <>
                  {approvedTemplates.length === 0 ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      Nenhum template aprovado esta disponivel para selecao.
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {approvedTemplates.map((template) => {
                        const isSelected =
                          campaignForm.templateId === template.id;

                        return (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() =>
                              handleCampaignFieldChange(
                                "templateId",
                                template.id,
                              )
                            }
                            className={`rounded-3xl border p-4 text-left transition ${
                              isSelected
                                ? "border-blue-500 bg-blue-50"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-slate-900">
                                  {template.internalName}
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                  {templateCategoryMap[template.category]} •{" "}
                                  {template.language}
                                </p>
                              </div>
                              <StatusBadge
                                {...templateStatusMap[template.status]}
                              />
                            </div>
                            <p className="mt-3 text-sm leading-6 text-slate-700">
                              {template.body}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : null}

              {campaignStep === 3 ? (
                <div className="space-y-4">
                  {[
                    {
                      value: "all" as AudienceType,
                      title: "Todos os contatos",
                      description:
                        "Use a base elegivel da operacao para ampliar o alcance.",
                    },
                    {
                      value: "tag" as AudienceType,
                      title: "Contatos com tag",
                      description:
                        "Envie mensagens para segmentos ja organizados pela equipe.",
                    },
                    {
                      value: "manual" as AudienceType,
                      title: "Selecao manual",
                      description:
                        "Informe contatos por telefone, nome ou id separados por virgula ou quebra de linha.",
                    },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        handleCampaignFieldChange("audienceType", option.value)
                      }
                      className={`w-full rounded-3xl border p-4 text-left transition ${
                        campaignForm.audienceType === option.value
                          ? "border-blue-500 bg-blue-50"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <p className="font-semibold text-slate-900">
                        {option.title}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {option.description}
                      </p>
                    </button>
                  ))}

                  {campaignForm.audienceType === "tag" ? (
                    <Field label="Nome da tag">
                      <input
                        value={campaignForm.tagLabel}
                        onChange={(event) =>
                          handleCampaignFieldChange(
                            "tagLabel",
                            event.target.value,
                          )
                        }
                        className={inputClassName}
                        placeholder="Ex: Clientes VIP"
                      />
                    </Field>
                  ) : null}

                  {campaignForm.audienceType === "manual" ? (
                    <Field
                      label="Selecao manual"
                      hint="Use telefones, nomes ou ids separados por virgula, ponto e virgula ou quebra de linha."
                    >
                      <textarea
                        value={campaignForm.manualSelection}
                        onChange={(event) =>
                          handleCampaignFieldChange(
                            "manualSelection",
                            event.target.value,
                          )
                        }
                        rows={4}
                        className={inputClassName}
                        placeholder="Ex: +5511999990001, Maria Silva"
                      />
                    </Field>
                  ) : null}
                </div>
              ) : null}

              {campaignStep === 4 ? (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => handleCampaignFieldChange("sendMode", "now")}
                    className={`w-full rounded-3xl border p-4 text-left transition ${
                      campaignForm.sendMode === "now"
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <p className="font-semibold text-slate-900">Criar agora</p>
                    <p className="mt-1 text-sm text-slate-500">
                      A campanha sera persistida agora, com destinatarios em
                      status pendente e sem envio real.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleCampaignFieldChange("sendMode", "scheduled")
                    }
                    className={`w-full rounded-3xl border p-4 text-left transition ${
                      campaignForm.sendMode === "scheduled"
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <p className="font-semibold text-slate-900">Agendar</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Programe a data e hora para a proxima janela interna de
                      envio.
                    </p>
                  </button>

                  {campaignForm.sendMode === "scheduled" ? (
                    <Field label="Data e hora">
                      <input
                        type="datetime-local"
                        value={campaignForm.scheduledAt}
                        onChange={(event) =>
                          handleCampaignFieldChange(
                            "scheduledAt",
                            event.target.value,
                          )
                        }
                        className={inputClassName}
                      />
                    </Field>
                  ) : null}
                </div>
              ) : null}

              {campaignStep === 5 ? (
                <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <div>
                    <p className="text-sm font-medium text-slate-500">
                      Nome da campanha
                    </p>
                    <p className="mt-1 font-semibold text-slate-900">
                      {campaignForm.name || "Nova campanha"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-500">
                      Template selecionado
                    </p>
                    <p className="mt-1 font-semibold text-slate-900">
                      {selectedCampaignTemplate?.internalName ??
                        "Nenhum template selecionado"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-500">
                      Publico
                    </p>
                    <p className="mt-1 font-semibold text-slate-900">
                      {buildAudienceLabel(campaignForm)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-500">Envio</p>
                    <p className="mt-1 font-semibold text-slate-900">
                      {campaignForm.sendMode === "scheduled"
                        ? `Agendado para ${formatDateTime(
                            new Date(campaignForm.scheduledAt).toISOString(),
                          )}`
                        : "Criacao imediata sem envio real"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-500">
                      Estimativa inicial
                    </p>
                    <p className="mt-1 font-semibold text-slate-900">
                      {audiencePreview.loading
                        ? "Calculando..."
                        : `${audiencePreview.count} contatos`}
                    </p>
                    {audiencePreview.error ? (
                      <p className="mt-2 text-xs text-rose-600">
                        {audiencePreview.error}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <Card className="h-fit rounded-3xl p-5">
              <h3 className="font-semibold text-slate-900">
                Resumo da campanha
              </h3>
              <div className="mt-4 space-y-4 text-sm text-slate-600">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="font-medium text-slate-900">Template</p>
                  <p className="mt-2 leading-6">
                    {selectedCampaignTemplate?.body ??
                      "Selecione um template aprovado para visualizar a mensagem."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <MegaphoneIcon className="h-4 w-4 text-blue-600" />
                  {campaignForm.channelLabel}
                </div>
                <div className="flex items-center gap-2">
                  <PlayCircleIcon className="h-4 w-4 text-emerald-600" />
                  {buildAudienceLabel(campaignForm)}
                </div>
                <div className="flex items-center gap-2">
                  {campaignForm.sendMode === "scheduled" ? (
                    <PauseCircleIcon className="h-4 w-4 text-indigo-600" />
                  ) : (
                    <SendIcon className="h-4 w-4 text-sky-600" />
                  )}
                  {campaignForm.sendMode === "scheduled"
                    ? `Agendamento em ${formatDateTime(
                        new Date(campaignForm.scheduledAt).toISOString(),
                      )}`
                    : "Campanha criada para persistencia imediata"}
                </div>
              </div>
            </Card>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 px-4 sm:px-6 py-4">
            <Button type="button" variant="ghost" onClick={resetCampaignForm}>
              Cancelar
            </Button>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setCampaignStep(
                    (current) => Math.max(1, current - 1) as CampaignWizardStep,
                  )
                }
                disabled={campaignStep === 1}
              >
                Voltar
              </Button>
              {campaignStep < 5 ? (
                <Button
                  type="button"
                  onClick={() =>
                    setCampaignStep(
                      (current) =>
                        Math.min(5, current + 1) as CampaignWizardStep,
                    )
                  }
                  disabled={!canAdvanceCampaignStep()}
                  className="rounded-full"
                >
                  Proxima etapa
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={handleSaveCampaign}
                  disabled={!selectedCampaignTemplate || campaignsSaving}
                  className="rounded-full"
                >
                  {campaignModalMode === "edit"
                    ? "Salvar campanha"
                    : "Confirmar campanha"}
                </Button>
              )}
            </div>
          </div>
        </ModalShell>
      ) : null}

      {metricsCampaignId ? (
        <ModalShell
          title="Metricas da campanha"
          subtitle="Acompanhe indicadores reais de entrega, leitura e respostas armazenados no banco."
          onClose={() => setMetricsCampaignId(null)}
          widthClassName="max-w-6xl"
        >
          {metricsCampaignLoading && !metricsCampaign ? (
            <div className="px-4 sm:px-6 py-6">
              <TableSkeleton rows={5} />
            </div>
          ) : metricsCampaign ? (
            <>
              <div className="space-y-6 px-4 sm:px-6 py-6">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <SummaryCard
                    label="Taxa de entrega"
                    value={formatPercent(
                      makeRate(
                        metricsCampaign.delivered,
                        metricsCampaign.totalContacts,
                      ),
                    )}
                    hint={`${metricsCampaign.delivered} entregues de ${metricsCampaign.totalContacts}.`}
                  />
                  <SummaryCard
                    label="Taxa de leitura"
                    value={formatPercent(
                      makeRate(
                        metricsCampaign.read,
                        metricsCampaign.totalContacts,
                      ),
                    )}
                    hint={`${metricsCampaign.read} mensagens lidas.`}
                  />
                  <SummaryCard
                    label="Taxa de resposta"
                    value={formatPercent(
                      makeRate(
                        metricsCampaign.replied,
                        metricsCampaign.totalContacts,
                      ),
                    )}
                    hint={`${metricsCampaign.replied} respostas registradas.`}
                  />
                  <SummaryCard
                    label="Erros"
                    value={String(metricsCampaign.failed)}
                    hint="Monitoramento de contatos com falha."
                  />
                </div>

                <Card className="rounded-3xl p-4 sm:p-6">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <p className="text-sm font-medium text-slate-500">
                        Nome da campanha
                      </p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {metricsCampaign.name}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-500">
                        Status
                      </p>
                      <div className="mt-1">
                        <StatusBadge
                          {...campaignStatusMap[metricsCampaign.status]}
                        />
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-500">
                        Template usado
                      </p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {metricsCampaign.template?.internalName ??
                          "Template removido"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-500">
                        Publico
                      </p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {metricsCampaign.audienceLabel}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-500">
                        Criada em
                      </p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {formatDateTime(metricsCampaign.createdAt)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-500">
                        Enviada/agendada em
                      </p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {formatDateTime(metricsCampaign.sendAt)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-500">
                        Total selecionado
                      </p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {metricsCampaign.totalContacts}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-500">
                        Total enviado
                      </p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {metricsCampaign.delivered + metricsCampaign.failed}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-500">
                        Total entregue
                      </p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {metricsCampaign.delivered}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-500">
                        Total lido
                      </p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {metricsCampaign.read}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-500">
                        Total respondido
                      </p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {metricsCampaign.replied}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-500">
                        Total com erro
                      </p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {metricsCampaign.failed}
                      </p>
                    </div>
                  </div>
                </Card>

                <Card className="rounded-3xl p-4 sm:p-6">
                  <div className="mb-4 flex items-center gap-2">
                    <BarChart3Icon className="h-5 w-5 text-slate-600" />
                    <h3 className="text-lg font-semibold text-slate-900">
                      Destinatarios da campanha
                    </h3>
                  </div>

                  {metricsRecipientsError ? (
                    <ErrorState
                      message={metricsRecipientsError}
                      onRetry={refetchMetricsRecipients}
                    />
                  ) : metricsRecipientsLoading ? (
                    <TableSkeleton />
                  ) : metricsRecipients.length === 0 ? (
                    <EmptyState
                      title="Nenhum destinatario encontrado"
                      description="Quando a campanha tiver publico resolvido, os destinatarios serao exibidos aqui."
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-[1050px] divide-y divide-slate-200">
                        <thead>
                          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            <th className="pb-3 pr-4">Nome</th>
                            <th className="pb-3 pr-4">Telefone</th>
                            <th className="pb-3 pr-4">Status</th>
                            <th className="pb-3 pr-4">Lida em</th>
                            <th className="pb-3 pr-4">Respondeu?</th>
                            <th className="pb-3 pr-4">Conversa</th>
                            <th className="pb-3">Erro</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {metricsRecipients.map((recipient) => (
                            <tr key={recipient.id} className="align-top">
                              <td className="py-4 pr-4 font-medium text-slate-900">
                                {recipient.name}
                              </td>
                              <td className="py-4 pr-4 text-sm text-slate-600">
                                {recipient.phone}
                              </td>
                              <td className="py-4 pr-4">
                                <StatusBadge
                                  {...recipientStatusMap[recipient.status]}
                                />
                              </td>
                              <td className="py-4 pr-4 text-sm text-slate-600">
                                {recipient.readAt
                                  ? formatDateTime(recipient.readAt)
                                  : "—"}
                              </td>
                              <td className="py-4 pr-4 text-sm text-slate-600">
                                {recipient.replied ? "Sim" : "Não"}
                              </td>
                              <td className="py-4 pr-4 text-sm text-slate-600">
                                {recipient.conversation}
                              </td>
                              <td className="py-4 text-sm text-slate-600">
                                {recipient.error ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>

              <div className="flex justify-end border-t border-slate-200 px-4 sm:px-6 py-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setMetricsCampaignId(null)}
                >
                  Fechar
                </Button>
              </div>
            </>
          ) : (
            <div className="px-4 sm:px-6 py-6">
              <EmptyState
                title="Campanha não encontrada"
                description="Não foi possivel carregar os detalhes desta campanha."
              />
            </div>
          )}
        </ModalShell>
      ) : null}
    </div>
  );
};
