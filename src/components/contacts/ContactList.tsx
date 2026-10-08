import React from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FacebookIcon,
  InstagramIcon,
  SearchIcon,
  UserRoundIcon,
} from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { Input } from "../ui/Input";
import { Badge } from "../ui/Badge";
import type {
  Contact,
  ContactListFilters,
  ContactStatus,
} from "../../modules/contacts/types/contacts";
import {
  channelLabels,
  formatDateTime,
  getInitials,
  statusLabels,
} from "./contactLabels";

type ContactListProps = {
  contacts: Contact[];
  filters: ContactListFilters;
  total: number;
  loading?: boolean;
  selectedContactId: string | null;
  onFiltersChange: (filters: ContactListFilters) => void;
  onSelectContact: (contact: Contact) => void;
};

const statusOptions: Array<ContactStatus | "all"> = [
  "all",
  "active",
  "inactive",
  "archived",
];

const ChannelIcon: React.FC<{ channel: Contact["channel"] }> = ({
  channel,
}) => {
  if (channel === "instagram") return <InstagramIcon className="h-3.5 w-3.5" />;
  if (channel === "facebook") return <FacebookIcon className="h-3.5 w-3.5" />;
  return <FaWhatsapp className="h-3.5 w-3.5" />;
};

export const ContactList: React.FC<ContactListProps> = ({
  contacts,
  filters,
  total,
  loading,
  selectedContactId,
  onFiltersChange,
  onSelectContact,
}) => {
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));

  const updateFilters = (next: Partial<ContactListFilters>) => {
    onFiltersChange({
      ...filters,
      ...next,
      page: next.page ?? 1,
    });
  };

  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-4">
        <div className="flex flex-col gap-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={filters.search}
              onChange={(event) => updateFilters({ search: event.target.value })}
              placeholder="Buscar por nome ou telefone"
              className="pl-9 text-sm"
            />
          </div>
          <select
            value={filters.status}
            onChange={(event) =>
              updateFilters({
                status: event.target.value as ContactStatus | "all",
              })
            }
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status === "all" ? "Todos os status" : statusLabels[status]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 sm:p-6 text-sm text-gray-500">Carregando clientes...</div>
        ) : contacts.length === 0 ? (
          <div className="p-4 sm:p-6 text-sm text-gray-500">
            Nenhum cliente encontrado.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {contacts.map((contact) => {
              const selected = selectedContactId === contact.id;
              return (
                <button
                  type="button"
                  key={contact.id}
                  onClick={() => onSelectContact(contact)}
                  className={`w-full px-4 py-3 text-left transition ${
                    selected ? "bg-blue-50" : "hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 text-sm font-semibold text-gray-700">
                      {contact.avatar_url ? (
                        <img
                          src={contact.avatar_url}
                          alt={contact.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        getInitials(contact.name) || (
                          <UserRoundIcon className="h-5 w-5" />
                        )
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-gray-950">
                            {contact.name}
                          </p>
                          <p className="truncate text-xs text-gray-500">
                            {contact.phone}
                          </p>
                        </div>
                        <Badge
                          variant={
                            contact.status === "active" ? "success" : "warning"
                          }
                        >
                          {statusLabels[contact.status]}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-gray-700">
                          <ChannelIcon channel={contact.channel} />
                          {channelLabels[contact.channel]}
                        </span>
                        <span className="truncate">
                          {contact.assigned_user_name ?? "Sem responsável"}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-gray-400">
                        Último contato: {formatDateTime(contact.last_contact_at)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-gray-100 p-3 text-sm text-gray-500">
        <span>
          Página {filters.page} de {totalPages}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => updateFilters({ page: Math.max(1, filters.page - 1) })}
            disabled={filters.page <= 1}
            className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Página anterior"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              updateFilters({ page: Math.min(totalPages, filters.page + 1) })
            }
            disabled={filters.page >= totalPages}
            className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Próxima página"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
};
