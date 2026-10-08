import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { toast } from "react-toastify";
import { ContactDashboard } from "../components/contacts/ContactDashboard";
import { ContactDetails } from "../components/contacts/ContactDetails";
import { ContactList } from "../components/contacts/ContactList";
import { AppSidebar } from "../components/layout/AppSidebar";
import { useAuth } from "../contexts/AuthContext";
import { useClinic } from "../contexts/ClinicContext";
import { useIsBelowLg } from "../hooks/useMediaQuery";
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
  // Abaixo de lg lista e detalhes ocupam a tela inteira, um de cada vez
  const isBelowLg = useIsBelowLg();
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const showMobileDetails = isBelowLg && mobileDetailsOpen && !!selectedContact;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [showMobileDetails]);

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
      <div
        ref={scrollRef}
        className="mx-auto flex h-full min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-4 sm:px-4 sm:py-5 lg:overflow-hidden"
      >
        {showMobileDetails ? (
          <>
            <button
              type="button"
              onClick={() => setMobileDetailsOpen(false)}
              className="inline-flex items-center gap-2 self-start rounded-lg py-1 pr-2 text-sm font-medium text-[#0A84FF]"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Voltar para a lista
            </button>
            <ContactDetails
              contact={selectedContact}
              notes={notes}
              notesLoading={notesLoading}
              savingNote={savingNote}
              onCreateNote={handleCreateNote}
              onDeleteNote={handleDeleteNote}
            />
          </>
        ) : (
          <>
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-950 sm:text-2xl">
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

        <div className="grid flex-1 grid-cols-1 gap-4 lg:min-h-0 lg:grid-cols-[420px_minmax(0,1fr)]">
          <ContactList
            contacts={contacts}
            filters={filters}
            total={total}
            loading={contactsLoading}
            selectedContactId={selectedContact?.id ?? null}
            onFiltersChange={setFilters}
            onSelectContact={(contact) => {
              setSelectedContact(contact);
              setMobileDetailsOpen(true);
            }}
          />
          <div className="hidden min-h-0 lg:flex lg:flex-col">
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
          </>
        )}
      </div>
    </div>
  );
};
