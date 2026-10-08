import React, { useState } from "react";
import {
  CalendarDaysIcon,
  MailIcon,
  PhoneIcon,
  TagIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Textarea } from "../ui/Textarea";
import type {
  Contact,
  ContactNote,
} from "../../modules/contacts/types/contacts";
import {
  channelLabels,
  commercialStatusLabels,
  formatDateTime,
  getInitials,
  statusLabels,
} from "./contactLabels";
import { SecureImage } from "../ui/SecureImage";

type ContactDetailsProps = {
  contact: Contact | null;
  notes: ContactNote[];
  notesLoading?: boolean;
  savingNote?: boolean;
  onCreateNote: (note: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
};

const DetailRow: React.FC<{
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
}> = ({ icon, label, value }) => (
  <div className="flex items-start gap-3 rounded-lg bg-gray-50 px-3 py-2">
    {icon ? <div className="mt-0.5 text-gray-400">{icon}</div> : null}
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <div className="mt-1 break-words text-sm text-gray-800">{value}</div>
    </div>
  </div>
);

export const ContactDetails: React.FC<ContactDetailsProps> = ({
  contact,
  notes,
  notesLoading,
  savingNote,
  onCreateNote,
  onDeleteNote,
}) => {
  const [draftNote, setDraftNote] = useState("");

  if (!contact) {
    return (
      <section className="flex min-h-0 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white p-5 sm:p-8 text-center text-sm text-gray-500">
        Selecione um cliente para ver os detalhes.
      </section>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const note = draftNote.trim();
    if (!note) return;
    await onCreateNote(note);
    setDraftNote("");
  };

  return (
    <section className="min-h-0 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div className="flex h-14 w-14 shrink-0 sm:h-16 sm:w-16 items-center justify-center overflow-hidden rounded-full bg-gray-100 text-lg font-semibold text-gray-700">
              {contact.avatar_url ? (
                <SecureImage
                  src={contact.avatar_url}
                  alt={contact.name}
                  className="h-full w-full object-cover"
                  fallback={getInitials(contact.name)}
                />
              ) : (
                getInitials(contact.name) || <UserRoundIcon className="h-6 w-6" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="break-words text-lg font-semibold text-gray-950 sm:text-xl">
                {contact.name}
              </h2>
              <p className="mt-1 text-sm text-gray-500">{contact.phone}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="channel">{channelLabels[contact.channel]}</Badge>
                <Badge
                  variant={contact.status === "active" ? "success" : "warning"}
                >
                  {statusLabels[contact.status]}
                </Badge>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm">
            <p className="text-xs font-medium text-blue-600">
              Status comercial
            </p>
            <p className="mt-1 font-semibold text-blue-950">
              {commercialStatusLabels[contact.commercial_status]}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-4 sm:p-5 md:grid-cols-2">
        <DetailRow
          label="Telefone"
          value={contact.phone}
          icon={<PhoneIcon className="h-4 w-4" />}
        />
        <DetailRow
          label="E-mail"
          value={contact.email ?? "Não informado"}
          icon={<MailIcon className="h-4 w-4" />}
        />
        <DetailRow label="Canal principal" value={channelLabels[contact.channel]} />
        <DetailRow
          label="Data de cadastro"
          value={formatDateTime(contact.created_at)}
          icon={<CalendarDaysIcon className="h-4 w-4" />}
        />
        <DetailRow
          label="Responsável"
          value={contact.assigned_user_name ?? "Sem responsável"}
        />
        <DetailRow
          label="Último contato"
          value={formatDateTime(contact.last_contact_at)}
        />
        <div className="md:col-span-2">
          <DetailRow
            label="Tags"
            icon={<TagIcon className="h-4 w-4" />}
            value={
              contact.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {contact.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                "Sem tags"
              )
            }
          />
        </div>
      </div>

      <div className="border-t border-gray-100 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-950">
              Notas internas
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Histórico privado para o time comercial e atendimento.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <Textarea
            value={draftNote}
            onChange={(event) => setDraftNote(event.target.value)}
            placeholder="Adicionar observação interna"
            className="text-sm"
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={!draftNote.trim() || savingNote}
              isLoading={savingNote}
            >
              Criar nota
            </Button>
          </div>
        </form>

        <div className="mt-5 space-y-3">
          {notesLoading ? (
            <p className="text-sm text-gray-500">Carregando notas...</p>
          ) : notes.length === 0 ? (
            <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">
              Nenhuma nota interna cadastrada.
            </p>
          ) : (
            notes.map((note) => (
              <div
                key={note.id}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {note.user_name ?? "Usuário"}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {formatDateTime(note.created_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteNote(note.id)}
                    disabled={savingNote}
                    className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Excluir nota"
                  >
                    <Trash2Icon className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">
                  {note.note}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
};
