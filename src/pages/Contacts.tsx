import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { ContactDashboard } from "../components/contacts/ContactDashboard";
import { ContactDetails } from "../components/contacts/ContactDetails";
import { ContactList } from "../components/contacts/ContactList";
import { AppSidebar } from "../components/layout/AppSidebar";
import { useAuth } from "../contexts/AuthContext";
import { useClinic } from "../contexts/ClinicContext";
import {
  useContactMetrics,
  useContactNotes,
  useContacts,
} from "../modules/contacts/hooks/useContacts";
import type {
  Contact,
  ContactListFilters,
} from "../modules/contacts/types/contacts";

const DEFAULT_FILTERS: ContactListFilters = {
  search: "",
  status: "all",
  page: 1,
  pageSize: 5,
};

export const ContactsPage: React.FC = () => {
  const { authUser } = useAuth();
  const { clinicId, loading: clinicLoading } = useClinic();
  const tenantId = clinicId;
  const [filters, setFilters] = useState<ContactListFilters>(DEFAULT_FILTERS);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  const {
    contacts,
    total,
    loading: contactsLoading,
    error: contactsError,
  } = useContacts(tenantId, filters);
  const {
    metrics,
    loading: metricsLoading,
    error: metricsError,
  } = useContactMetrics(tenantId);
  const {
    notes,
    loading: notesLoading,
    saving: savingNote,
    error: notesError,
    createNote,
    deleteNote,
  } = useContactNotes(tenantId, selectedContact?.id ?? null);

  useEffect(() => {
    if (selectedContact && contacts.some((contact) => contact.id === selectedContact.id)) {
      return;
    }
    setSelectedContact(contacts[0] ?? null);
  }, [contacts, selectedContact]);

  useEffect(() => {
    const message = contactsError ?? metricsError ?? notesError;
    if (message) toast.error(message);
  }, [contactsError, metricsError, notesError]);

  const emptyStateLabel = useMemo(() => {
    if (clinicLoading) return "Carregando empresa...";
    if (!clinicId) return "Não foi possível identificar a empresa do seu usuário.";
    return null;
  }, [clinicId, clinicLoading]);

  const handleCreateNote = async (note: string) => {
    if (!authUser?.id) return;
    await createNote(authUser.id, note);
    toast.success("Nota criada.");
  };

  const handleDeleteNote = async (noteId: string) => {
    await deleteNote(noteId);
    toast.success("Nota excluída.");
  };

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-[#F7F8FA]">
      <AppSidebar />
      <div className="mx-auto flex h-full min-w-0 flex-1 flex-col gap-4 overflow-hidden px-4 py-5">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-950">
              Carteira de Clientes
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              CRM leve para contatos que já conversaram com a empresa.
            </p>
          </div>
          {emptyStateLabel ? (
            <span className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {emptyStateLabel}
            </span>
          ) : null}
        </header>

        <ContactDashboard metrics={metrics} loading={metricsLoading} />

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
          <ContactList
            contacts={contacts}
            filters={filters}
            total={total}
            loading={contactsLoading}
            selectedContactId={selectedContact?.id ?? null}
            onFiltersChange={setFilters}
            onSelectContact={setSelectedContact}
          />
          <ContactDetails
            contact={selectedContact}
            notes={notes}
            notesLoading={notesLoading}
            savingNote={savingNote}
            onCreateNote={handleCreateNote}
            onDeleteNote={handleDeleteNote}
          />
        </div>
      </div>
    </div>
  );
};
