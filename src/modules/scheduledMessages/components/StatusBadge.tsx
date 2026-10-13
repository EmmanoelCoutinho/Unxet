import React from "react";
import type {
  ScheduledMessageStatus,
  ScheduledRecipientStatus,
} from "../types/scheduledMessages";
import {
  MESSAGE_STATUS_LABEL,
  RECIPIENT_STATUS_LABEL,
} from "../utils/schedule";

const BASE =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium";

const MESSAGE_STYLE: Record<ScheduledMessageStatus, string> = {
  scheduled: "bg-blue-50 text-blue-700",
  processing: "bg-amber-50 text-amber-700",
  sent: "bg-green-50 text-green-700",
  partial: "bg-orange-50 text-orange-700",
  failed: "bg-red-50 text-red-700",
  cancelled: "bg-slate-100 text-slate-600",
};

const RECIPIENT_STYLE: Record<ScheduledRecipientStatus, string> = {
  pending: "bg-blue-50 text-blue-700",
  sending: "bg-amber-50 text-amber-700",
  sent: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-700",
  cancelled: "bg-slate-100 text-slate-600",
};

export const MessageStatusBadge: React.FC<{ status: ScheduledMessageStatus }> = ({
  status,
}) => (
  <span className={`${BASE} ${MESSAGE_STYLE[status]}`}>
    {status === "processing" && (
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
    )}
    {MESSAGE_STATUS_LABEL[status]}
  </span>
);

export const RecipientStatusBadge: React.FC<{
  status: ScheduledRecipientStatus;
}> = ({ status }) => (
  <span className={`${BASE} ${RECIPIENT_STYLE[status]}`}>
    {RECIPIENT_STATUS_LABEL[status]}
  </span>
);
