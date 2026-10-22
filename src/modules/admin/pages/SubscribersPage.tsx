import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  History,
  Lock,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "react-toastify";
import { Button } from "../../../components/ui/Button";
import { useConfirm } from "../../../components/ui/ConfirmDialog";
import {
  BILLING_CYCLE_LABELS,
  DEFAULT_GRACE_DAYS,
  PAYMENT_METHOD_LABELS,
  PLAN_CODES,
  PLAN_HIGHLIGHTS,
  PLAN_NAMES,
  SUBSCRIPTION_STATUS_LABELS,
  type BillingCycle,
  type PaymentMethod,
  type PlanCode,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from "../../../constants/plans";
import { formatIsoDateBr } from "../../../lib/billingNotice";
import { moneyInput, parseMoney } from "../../../lib/money";
import { adminSupabase } from "../lib/adminSupabaseClient";
import {
  DUE_SOON_DAYS,
  addPeriodsIso,
  formatMoney,
  formatUsage,
  getDueState,
  getPlanAlerts,
  predictStatus,
  todayIso,
  type DueState,
  type PlatformSubscriptions,
  type SubscriberRow,
  type SubscriptionPayment,
} from "../lib/subscriptions";

const STATUSES = Object.keys(
  SUBSCRIPTION_STATUS_LABELS,
) as SubscriptionStatus[];
const CYCLES = Object.keys(BILLING_CYCLE_LABELS) as BillingCycle[];
const METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];

const PLAN_BADGE: Record<PlanCode, string> = {
  essencial: "bg-slate-100 text-slate-700",
  profissional: "bg-blue-50 text-blue-700",
  empresarial: "bg-[#003366] text-white",
};

const STATUS_BADGE: Record<SubscriptionStatus, string> = {
  trial: "bg-violet-50 text-violet-700",
  active: "bg-emerald-50 text-emerald-700",
  past_due: "bg-amber-50 text-amber-800",
  suspended: "bg-rose-100 text-rose-800",
  canceled: "bg-slate-100 text-slate-500",
};

const fieldClassName =
  "w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]";

const labelClassName = "mb-1 block text-sm font-medium text-[#1E1E1E]";

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("pt-BR") : "–";

const formatIsoDate = (value: string | null) =>
  value ? formatIsoDateBr(value) : "–";

const plural = (value: number, one: string, many: string) =>
  `${value} ${value === 1 ? one : many}`;

// O Postgres devolve o motivo em message; erros de permissão viram texto genérico
const rpcErrorMessage = (
  error: { message?: string; code?: string },
  fallback: string,
) =>
  error.code === "42501"
    ? "Sua conta não tem permissão para esta ação."
    : error.message || fallback;

const fetchSubscriptions = async () => {
  const { data, error } = await adminSupabase.rpc("platform_subscriptions");
  if (error) throw error;
  return data as PlatformSubscriptions;
};

const fetchPayments = async (clinicId: string) => {
  const { data, error } = await adminSupabase.rpc(
    "platform_subscription_payments",
    {
      p_clinic_id: clinicId,
    },
  );
  if (error) throw error;
  return (data ?? []) as SubscriptionPayment[];
};

const DueLabel = ({ due, end }: { due: DueState; end: string | null }) => {
  if (due.kind === "overdue") {
    return (
      <span className="font-medium text-rose-700">
        {formatIsoDate(end)} · vencida há {plural(due.days, "dia", "dias")}
        <span className="block text-xs font-normal">
          {due.daysToSuspension === 0
            ? "suspensão na próxima verificação"
            : `suspensão em ${plural(due.daysToSuspension, "dia", "dias")}`}
        </span>
      </span>
    );
  }
  if (due.kind === "soon") {
    return (
      <span className="font-medium text-amber-700">
        {formatIsoDate(end)} ·{" "}
        {due.days === 0
          ? "vence hoje"
          : `vence em ${plural(due.days, "dia", "dias")}`}
      </span>
    );
  }
  return <span className="text-slate-700">{formatIsoDate(end)}</span>;
};

const StatCard = ({
  label,
  value,
  tone = "default",
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone?: "default" | "warning" | "danger";
  active?: boolean;
  onClick?: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={[
      "flex flex-col rounded-xl border bg-white p-3 text-left shadow-sm transition sm:p-4",
      active
        ? "border-[#003366] ring-1 ring-[#003366]"
        : "border-slate-200 hover:border-slate-300",
    ].join(" ")}
  >
    <span className="text-xs text-slate-500 sm:text-sm">{label}</span>
    <span
      className={[
        "mt-2 text-2xl font-semibold sm:text-3xl",
        tone === "danger" && value > 0
          ? "text-rose-700"
          : tone === "warning" && value > 0
            ? "text-amber-700"
            : "text-slate-900",
      ].join(" ")}
    >
      {value}
    </span>
  </button>
);

const Modal = ({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) => {
  // Esc fecha, como nos outros diálogos do sistema
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Confirmação aberta por cima (ex.: excluir pagamento): o Esc é dela
      if (
        document.querySelector(
          '[role="alertdialog"], [role="dialog"][data-state="open"]',
        )
      )
        return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-3 py-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-full w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl bg-white shadow-xl"
      >
        <div className="flex items-start justify-between border-b px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-gray-900">
              {title}
            </h2>
            <p className="text-sm text-gray-500">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-500 hover:bg-gray-100"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-5 sm:px-6">{children}</div>
      </div>
    </div>
  );
};

const EditSubscriptionModal = ({
  clinic,
  plans,
  today,
  onClose,
  onSaved,
}: {
  clinic: SubscriberRow;
  plans: SubscriptionPlan[];
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [planCode, setPlanCode] = useState<PlanCode>(clinic.plan_code);
  const [status, setStatus] = useState<SubscriptionStatus>(clinic.status);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(
    clinic.billing_cycle,
  );
  const [price, setPrice] = useState(moneyInput(clinic.price));
  const [graceDays, setGraceDays] = useState(
    String(clinic.grace_days ?? DEFAULT_GRACE_DAYS),
  );
  const [periodEnd, setPeriodEnd] = useState(clinic.current_period_end ?? "");
  const [notes, setNotes] = useState(clinic.notes ?? "");
  const [saving, setSaving] = useState(false);

  const plan = plans.find((p) => p.code === planCode);
  // Prévia do que ficaria acima do plano escolhido
  const alerts = getPlanAlerts({ ...clinic, plan_code: planCode }, plan);

  // Escolher "Suspensa" é manual, a não ser que já estivesse suspensa por atraso
  const manualSuspension =
    status === "suspended" &&
    !(clinic.status === "suspended" && clinic.blocked_reason === "overdue");
  const graceNumber = Number(graceDays);
  const predicted = predictStatus(
    status,
    periodEnd || null,
    Number.isInteger(graceNumber) ? graceNumber : clinic.grace_days,
    today,
    manualSuspension,
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const priceValue = parseMoney(price);
    if (priceValue !== null && !(priceValue >= 0)) {
      toast.error("Valor inválido.");
      return;
    }
    const grace = Number(graceDays);
    if (!Number.isInteger(grace) || grace < 0 || grace > 90) {
      toast.error("A carência deve ficar entre 0 e 90 dias.");
      return;
    }

    setSaving(true);
    const { error } = await adminSupabase.rpc("platform_set_subscription", {
      p_clinic_id: clinic.id,
      p_plan_code: planCode,
      p_status: status,
      p_current_period_end: periodEnd || null,
      p_notes: notes,
      p_billing_cycle: billingCycle,
      p_price: priceValue,
      p_grace_days: grace,
    });
    setSaving(false);
    if (error) {
      toast.error(
        rpcErrorMessage(error, "Não foi possível salvar a assinatura."),
      );
      return;
    }
    toast.success(`Assinatura de ${clinic.name} atualizada.`);
    onSaved();
  }

  return (
    <Modal
      title={clinic.name}
      subtitle="Plano, cobrança e situação"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <span className={labelClassName}>Plano</span>
          <div
            className="grid gap-2 sm:grid-cols-3"
            role="group"
            aria-label="Plano"
          >
            {PLAN_CODES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setPlanCode(code)}
                className={[
                  "rounded-lg border px-3 py-2 text-sm font-medium transition",
                  planCode === code
                    ? "border-[#003366] bg-[#003366] text-white"
                    : "border-slate-200 text-slate-700 hover:border-slate-300",
                ].join(" ")}
                aria-pressed={planCode === code}
              >
                {PLAN_NAMES[code]}
              </button>
            ))}
          </div>
          <ul className="mt-3 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
            {PLAN_HIGHLIGHTS[planCode].map((item) => (
              <li key={item} className="flex gap-1.5">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {alerts.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <p className="font-medium">Fica acima deste plano:</p>
            <ul className="mt-1 list-inside list-disc">
              {alerts.map((alert) => (
                <li key={alert}>{alert}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs">
              Nada é apagado: a empresa só não consegue criar mais e os recursos
              fora do plano somem do app.
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className={labelClassName}>Cobrança</span>
            <select
              value={billingCycle}
              onChange={(e) => setBillingCycle(e.target.value as BillingCycle)}
              className={fieldClassName}
            >
              {CYCLES.map((value) => (
                <option key={value} value={value}>
                  {BILLING_CYCLE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClassName}>
              {billingCycle === "annual" ? "Anuidade (R$)" : "Mensalidade (R$)"}
            </span>
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="199,90"
              className={fieldClassName}
            />
          </label>
          <label className="block">
            <span className={labelClassName}>Carência (dias)</span>
            <input
              type="number"
              min={0}
              max={90}
              value={graceDays}
              onChange={(e) => setGraceDays(e.target.value)}
              className={fieldClassName}
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelClassName}>Situação</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
              className={fieldClassName}
            >
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {SUBSCRIPTION_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClassName}>Vencimento</span>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className={fieldClassName}
            />
          </label>
        </div>
        {predicted !== status && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Com este vencimento, a situação fica{" "}
            <strong>{SUBSCRIPTION_STATUS_LABELS[predicted]}</strong> ao salvar.
            {predicted === "past_due" &&
              " Para deixá-la em dia, registre o pagamento ou mude o vencimento."}
            {predicted === "suspended" &&
              " O app da empresa fica travado. Para liberar, registre o pagamento ou mude o vencimento."}
          </div>
        )}
        <p className="text-xs text-slate-500">
          O vencimento avança sozinho ao registrar um pagamento. A rotina marca
          inadimplente após o vencimento e suspende depois da carência;
          suspender por aqui é manual e só sai quando você reativar.
        </p>

        <label className="block">
          <span className={labelClassName}>Observações</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Ex.: desconto negociado, contato financeiro"
            className={fieldClassName}
          />
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="secondary" isLoading={saving}>
            Salvar
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const RegisterPaymentModal = ({
  clinic,
  today,
  onClose,
  onSaved,
}: {
  clinic: SubscriberRow;
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [paidAt, setPaidAt] = useState(today);
  const [amount, setAmount] = useState(moneyInput(clinic.price));
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [periods, setPeriods] = useState(1);
  // Padrão do banco: continua do vencimento atual (ou começa no dia do pagamento)
  const [periodStart, setPeriodStart] = useState(
    clinic.current_period_end ?? today,
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const periodEnd = periodStart
    ? addPeriodsIso(periodStart, clinic.billing_cycle, periods)
    : null;
  const unit =
    clinic.billing_cycle === "annual" ? ["ano", "anos"] : ["mês", "meses"];
  const stillOverdue = periodEnd !== null && periodEnd < today;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const amountValue = parseMoney(amount);
    if (amountValue === null || !(amountValue >= 0)) {
      toast.error("Informe o valor pago.");
      return;
    }
    if (!paidAt || !periodStart) {
      toast.error("Informe as datas.");
      return;
    }

    setSaving(true);
    const { error } = await adminSupabase.rpc("platform_register_payment", {
      p_clinic_id: clinic.id,
      p_paid_at: paidAt,
      p_amount: amountValue,
      p_method: method,
      p_periods: periods,
      p_notes: notes,
      p_period_start: periodStart,
    });
    setSaving(false);
    if (error) {
      toast.error(
        rpcErrorMessage(error, "Não foi possível registrar o pagamento."),
      );
      return;
    }
    toast.success(
      `Pagamento registrado. ${clinic.name} vence agora em ${formatIsoDate(periodEnd)}.`,
    );
    onSaved();
  }

  return (
    <Modal
      title="Registrar pagamento"
      subtitle={`${clinic.name} · ${BILLING_CYCLE_LABELS[clinic.billing_cycle]}`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelClassName}>Data do pagamento</span>
            <input
              type="date"
              value={paidAt}
              max={today}
              onChange={(e) => setPaidAt(e.target.value)}
              className={fieldClassName}
              required
            />
          </label>
          <label className="block">
            <span className={labelClassName}>Valor (R$)</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="199,90"
              className={fieldClassName}
              required
            />
          </label>
          <label className="block">
            <span className={labelClassName}>Forma de pagamento</span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              className={fieldClassName}
            >
              {METHODS.map((value) => (
                <option key={value} value={value}>
                  {PAYMENT_METHOD_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClassName}>Quanto tempo pagou</span>
            <select
              value={periods}
              onChange={(e) => setPeriods(Number(e.target.value))}
              className={fieldClassName}
            >
              {Array.from(
                { length: clinic.billing_cycle === "annual" ? 3 : 12 },
                (_, index) => index + 1,
              ).map((value) => (
                <option key={value} value={value}>
                  {value} {value === 1 ? unit[0] : unit[1]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className={labelClassName}>Período pago a partir de</span>
          <input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className={fieldClassName}
            required
          />
          <p className="mt-1 text-xs text-slate-500">
            Normalmente o vencimento atual. Use a data de hoje para recomeçar a
            contagem (ex.: empresa que ficou meses suspensa).
          </p>
        </label>

        {periodEnd && (
          <div
            className={[
              "rounded-lg border px-3 py-2 text-sm",
              stillOverdue
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800",
            ].join(" ")}
          >
            Cobre de {formatIsoDate(periodStart)} a {formatIsoDate(periodEnd)}.
            Novo vencimento: <strong>{formatIsoDate(periodEnd)}</strong>.
            {stillOverdue && " Ainda fica vencida depois deste pagamento."}
          </div>
        )}

        {(clinic.status === "canceled" ||
          (clinic.status === "suspended" &&
            clinic.blocked_reason === "manual")) && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            A empresa está{" "}
            {clinic.status === "canceled"
              ? "cancelada"
              : "suspensa manualmente"}
            : o pagamento avança o vencimento, mas a situação só muda pelo
            Editar.
          </p>
        )}

        <label className="block">
          <span className={labelClassName}>Observação</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            placeholder="Ex.: nº do comprovante, quem pagou"
            className={fieldClassName}
          />
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="secondary" isLoading={saving}>
            Registrar
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const PaymentHistoryModal = ({
  clinic,
  onClose,
  onChanged,
}: {
  clinic: SubscriberRow;
  onClose: () => void;
  onChanged: () => void;
}) => {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { data, error, isLoading } = useQuery({
    queryKey: ["platform-subscription-payments", clinic.id],
    queryFn: () => fetchPayments(clinic.id),
  });

  const total = (data ?? []).reduce(
    (sum, payment) => sum + Number(payment.amount),
    0,
  );

  async function handleDelete(payment: SubscriptionPayment) {
    const ok = await confirm({
      title: "Excluir pagamento?",
      description:
        payment.period_end === clinic.current_period_end
          ? `O vencimento volta para ${formatIsoDate(payment.period_start)}.`
          : "O vencimento atual não muda (há pagamentos depois deste).",
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (!ok) return;

    setDeletingId(payment.id);
    const { error: deleteError } = await adminSupabase.rpc(
      "platform_delete_payment",
      {
        p_payment_id: payment.id,
      },
    );
    setDeletingId(null);
    if (deleteError) {
      toast.error(
        rpcErrorMessage(deleteError, "Não foi possível excluir o pagamento."),
      );
      return;
    }
    toast.success("Pagamento excluído.");
    queryClient.invalidateQueries({
      queryKey: ["platform-subscription-payments", clinic.id],
    });
    onChanged();
  }

  return (
    <Modal
      title="Histórico de pagamentos"
      subtitle={clinic.name}
      onClose={onClose}
    >
      {error ? (
        <p className="text-sm text-rose-700">
          Não foi possível carregar os pagamentos.
        </p>
      ) : isLoading || !data ? (
        <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
      ) : data.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum pagamento registrado.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-600">
            {plural(data.length, "pagamento", "pagamentos")} · total{" "}
            {formatMoney(total)}
          </p>
          <ul className="divide-y divide-slate-100">
            {data.map((payment) => (
              <li
                key={payment.id}
                className="flex items-start justify-between gap-3 py-3"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-slate-900">
                    {formatMoney(payment.amount)} ·{" "}
                    {PAYMENT_METHOD_LABELS[payment.method]}
                  </p>
                  <p className="text-xs text-slate-500">
                    Pago em {formatIsoDate(payment.paid_at)} · cobre{" "}
                    {formatIsoDate(payment.period_start)} a{" "}
                    {formatIsoDate(payment.period_end)}
                  </p>
                  {payment.notes && (
                    <p className="mt-0.5 text-xs text-slate-600">
                      {payment.notes}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(payment)}
                  disabled={deletingId === payment.id}
                  className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                  aria-label="Excluir pagamento"
                  title="Excluir pagamento"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
};

type QuickFilter =
  "all" | "overdue" | "soon" | "past_due" | "suspended" | "trial" | "alerts";

type Dialog =
  | { kind: "edit"; clinic: SubscriberRow }
  | { kind: "payment"; clinic: SubscriberRow }
  | { kind: "history"; clinic: SubscriberRow };

export const SubscribersPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["platform-subscriptions"],
    queryFn: fetchSubscriptions,
  });

  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<PlanCode | "all">("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [dialog, setDialog] = useState<Dialog | null>(null);

  // Mesmo "hoje" da rotina (fuso de São Paulo, vindo do banco)
  const today = data?.today ?? todayIso();

  const rows = useMemo(() => {
    if (!data) return [];
    const plansByCode = new Map(data.plans.map((plan) => [plan.code, plan]));
    return data.clinics.map((clinic) => {
      const plan = plansByCode.get(clinic.plan_code);
      return {
        clinic,
        plan,
        due: getDueState(clinic, today),
        alerts: getPlanAlerts(clinic, plan),
      };
    });
  }, [data, today]);

  const counts = useMemo(
    () => ({
      total: rows.length,
      byPlan: Object.fromEntries(
        PLAN_CODES.map((code) => [
          code,
          rows.filter((row) => row.clinic.plan_code === code).length,
        ]),
      ) as Record<PlanCode, number>,
      overdue: rows.filter((row) => row.due.kind === "overdue").length,
      soon: rows.filter((row) => row.due.kind === "soon").length,
      pastDue: rows.filter((row) => row.clinic.status === "past_due").length,
      suspended: rows.filter((row) => row.clinic.status === "suspended").length,
      trial: rows.filter((row) => row.clinic.status === "trial").length,
      alerts: rows.filter((row) => row.alerts.length > 0).length,
    }),
    [rows],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (term && !row.clinic.name.toLowerCase().includes(term)) return false;
      if (planFilter !== "all" && row.clinic.plan_code !== planFilter)
        return false;
      switch (quickFilter) {
        case "overdue":
          return row.due.kind === "overdue";
        case "soon":
          return row.due.kind === "soon";
        case "past_due":
          return row.clinic.status === "past_due";
        case "suspended":
          return row.clinic.status === "suspended";
        case "trial":
          return row.clinic.status === "trial";
        case "alerts":
          return row.alerts.length > 0;
        default:
          return true;
      }
    });
  }, [rows, search, planFilter, quickFilter]);

  const toggleQuick = (filter: QuickFilter) =>
    setQuickFilter((current) => (current === filter ? "all" : filter));

  const reload = () =>
    queryClient.invalidateQueries({ queryKey: ["platform-subscriptions"] });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Assinantes</h1>
          <p className="mt-1 text-sm text-gray-500">
            Plano, cobrança e situação de cada empresa. Vencidas viram
            inadimplentes e, depois da carência, são suspensas automaticamente.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5"
        >
          <RefreshCw
            className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
          />
          Atualizar
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Não foi possível carregar os assinantes.
        </div>
      ) : isLoading || !data ? (
        <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {PLAN_CODES.map((code) => (
              <StatCard
                key={code}
                label={PLAN_NAMES[code]}
                value={counts.byPlan[code]}
                active={planFilter === code}
                onClick={() =>
                  setPlanFilter((current) => (current === code ? "all" : code))
                }
              />
            ))}
            <StatCard
              label="Total de empresas"
              value={counts.total}
              active={planFilter === "all" && quickFilter === "all"}
              onClick={() => {
                setPlanFilter("all");
                setQuickFilter("all");
              }}
            />
            <StatCard
              label="Vencidas"
              value={counts.overdue}
              tone="danger"
              active={quickFilter === "overdue"}
              onClick={() => toggleQuick("overdue")}
            />
            <StatCard
              label={`Vencem em ${DUE_SOON_DAYS} dias`}
              value={counts.soon}
              tone="warning"
              active={quickFilter === "soon"}
              onClick={() => toggleQuick("soon")}
            />
            <StatCard
              label="Suspensas"
              value={counts.suspended}
              tone="danger"
              active={quickFilter === "suspended"}
              onClick={() => toggleQuick("suspended")}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar empresa"
              className={`${fieldClassName} max-w-xs`}
            />
            <select
              value={quickFilter}
              onChange={(e) => setQuickFilter(e.target.value as QuickFilter)}
              className={`${fieldClassName} w-auto`}
            >
              <option value="all">Todas as situações</option>
              <option value="trial">Em teste ({counts.trial})</option>
              <option value="past_due">Inadimplentes ({counts.pastDue})</option>
              <option value="suspended">Suspensas ({counts.suspended})</option>
              <option value="overdue">Vencidas</option>
              <option value="soon">Vencendo</option>
              <option value="alerts">Acima do plano ({counts.alerts})</option>
            </select>
            <span className="text-sm text-slate-500">
              {plural(visible.length, "empresa", "empresas")}
            </span>
          </div>

          {visible.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
              Nenhuma empresa neste filtro.
            </p>
          ) : (
            <ul className="space-y-3">
              {visible.map(({ clinic, plan, due, alerts }) => (
                <li
                  key={clinic.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-semibold text-slate-900">
                          {clinic.name}
                        </h3>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${PLAN_BADGE[clinic.plan_code]}`}
                        >
                          {PLAN_NAMES[clinic.plan_code]}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[clinic.status]}`}
                        >
                          {SUBSCRIPTION_STATUS_LABELS[clinic.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {BILLING_CYCLE_LABELS[clinic.billing_cycle]} ·{" "}
                        {formatMoney(clinic.price)} · cliente desde{" "}
                        {formatDate(clinic.created_at)} · última mensagem{" "}
                        {formatDate(clinic.last_message_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDialog({ kind: "payment", clinic })}
                        className="inline-flex items-center gap-1.5"
                      >
                        <Banknote className="h-4 w-4" />
                        Pagamento
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDialog({ kind: "history", clinic })}
                        className="inline-flex items-center gap-1.5"
                      >
                        <History className="h-4 w-4" />
                        Histórico
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDialog({ kind: "edit", clinic })}
                        className="inline-flex items-center gap-1.5"
                      >
                        <Pencil className="h-4 w-4" />
                        Editar
                      </Button>
                    </div>
                  </div>

                  {clinic.status === "suspended" && (
                    <div className="mt-3 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                      <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        Suspensa{" "}
                        {clinic.blocked_reason === "manual"
                          ? "manualmente"
                          : "por inadimplência"}
                        {clinic.blocked_at
                          ? ` desde ${formatDate(clinic.blocked_at)}`
                          : ""}
                        . O app está travado para a equipe; as mensagens
                        continuam chegando.
                      </span>
                    </div>
                  )}

                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
                    <div>
                      <dt className="text-xs text-slate-500">Vencimento</dt>
                      <dd>
                        <DueLabel due={due} end={clinic.current_period_end} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">
                        Último pagamento
                      </dt>
                      <dd className="text-slate-800">
                        {clinic.last_payment_at ? (
                          <>
                            {formatIsoDate(clinic.last_payment_at)}
                            <span className="block text-xs text-slate-500">
                              {formatMoney(clinic.last_payment_amount)}
                              {clinic.last_payment_method
                                ? ` · ${PAYMENT_METHOD_LABELS[clinic.last_payment_method]}`
                                : ""}
                            </span>
                          </>
                        ) : (
                          "–"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Atendentes</dt>
                      <dd className="text-slate-800">
                        {formatUsage(
                          clinic.attendants,
                          plan?.max_attendants ?? null,
                        )}
                        {clinic.pending_invites > 0 && (
                          <span className="block text-xs text-slate-500">
                            {plural(
                              clinic.pending_invites,
                              "convite pendente",
                              "convites pendentes",
                            )}
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">
                        WhatsApp em uso
                      </dt>
                      <dd className="text-slate-800">
                        {formatUsage(
                          clinic.whatsapp,
                          plan?.max_whatsapp_numbers ?? null,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">
                        Instagram / Messenger
                      </dt>
                      <dd className="text-slate-800">
                        {clinic.instagram + clinic.messenger > 0
                          ? [
                              clinic.instagram > 0 ? "Instagram" : null,
                              clinic.messenger > 0 ? "Messenger" : null,
                            ]
                              .filter(Boolean)
                              .join(" e ")
                          : "–"}
                      </dd>
                    </div>
                  </dl>

                  {alerts.length > 0 && (
                    <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>Acima do plano: {alerts.join(" · ")}</span>
                    </div>
                  )}

                  {clinic.notes && (
                    <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                      {clinic.notes}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {dialog?.kind === "edit" && data && (
        <EditSubscriptionModal
          clinic={dialog.clinic}
          plans={data.plans}
          today={today}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {dialog?.kind === "payment" && (
        <RegisterPaymentModal
          clinic={dialog.clinic}
          today={today}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {dialog?.kind === "history" && (
        <PaymentHistoryModal
          clinic={dialog.clinic}
          onClose={() => setDialog(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
};
