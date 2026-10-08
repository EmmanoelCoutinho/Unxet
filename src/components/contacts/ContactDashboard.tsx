import React from "react";
import {
  ActivityIcon,
  Clock3Icon,
  TimerOffIcon,
  UsersIcon,
} from "lucide-react";
import type { ContactMetrics } from "../../modules/contacts/types/contacts";

const metricItems = [
  {
    key: "total",
    label: "Total de clientes",
    icon: UsersIcon,
  },
  {
    key: "active",
    label: "Clientes ativos",
    icon: ActivityIcon,
  },
  {
    key: "inactive7Days",
    label: "Sem contato há 7 dias",
    icon: Clock3Icon,
  },
  {
    key: "inactive30Days",
    label: "Sem contato há 30 dias",
    icon: TimerOffIcon,
  },
] as const;

type ContactDashboardProps = {
  metrics: ContactMetrics;
  loading?: boolean;
};

export const ContactDashboard: React.FC<ContactDashboardProps> = ({
  metrics,
  loading,
}) => {
  return (
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {metricItems.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.key}
            className="rounded-lg border border-gray-200 bg-white px-3 py-3 shadow-sm sm:px-4"
          >
            <div className="flex items-start justify-between gap-2 sm:items-center sm:gap-3">
              <p className="text-xs font-medium text-gray-500 sm:text-sm">{item.label}</p>
              <span className="flex h-8 w-8 flex-shrink-0 items-center sm:h-9 sm:w-9 justify-center rounded-lg bg-blue-50 text-[#0A84FF]">
                <Icon className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-2 text-xl font-semibold text-gray-950 sm:mt-3 sm:text-2xl">
              {loading ? "..." : metrics[item.key]}
            </p>
          </div>
        );
      })}
    </section>
  );
};
