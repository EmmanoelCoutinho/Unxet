import { AlertTriangleIcon, CalendarClockIcon } from "lucide-react";
import { useClinic } from "../../contexts/ClinicContext";
import {
  billingNoticeText,
  getBillingNotice,
  todayIso,
} from "../../lib/billingNotice";

// Faixa de cobrança abaixo da barra superior, só para os admins da empresa:
// pagamento em atraso (com os dias até a suspensão) e fim do plano anual
export const BillingBanner = () => {
  const { subscription, membership } = useClinic();

  if (!subscription || membership?.role !== "admin") return null;

  const notice = getBillingNotice(subscription, todayIso());
  if (!notice) return null;

  const strong =
    notice.kind === "overdue" || (notice.kind === "annual_ending" && notice.urgent);
  const Icon = notice.kind === "overdue" ? AlertTriangleIcon : CalendarClockIcon;

  return (
    <div
      role="status"
      className={[
        "flex shrink-0 items-center justify-center gap-2 border-b px-3 py-2 text-center text-xs font-medium sm:text-sm",
        notice.kind === "overdue"
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : strong
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-blue-200 bg-blue-50 text-blue-800",
      ].join(" ")}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span>{billingNoticeText(notice)}</span>
    </div>
  );
};
