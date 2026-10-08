import React, { useMemo, useState } from "react";
import {
  MessageSquareTextIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "react-toastify";
import { useClinic } from "../contexts/ClinicContext";
import { useQuickMessages } from "../hooks/useQuickMessages";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import PreTitleIcon from "../components/ui/PreTitleIcon";
import { CgClose } from "react-icons/cg";

type ModalMode = "create" | "edit" | "delete";

export const QuickMessagesPage: React.FC = () => {
  const { clinicId, membership } = useClinic();
  const isAdmin = membership?.role === "admin";
  const {
    quickMessages,
    loading,
    saving,
    error,
    createQuickMessage,
    updateQuickMessage,
    deleteQuickMessage,
    refetch,
  } = useQuickMessages(clinicId);

  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedMessage = useMemo(
    () => quickMessages.find((item) => item.id === selectedId) ?? null,
    [quickMessages, selectedId],
  );

  const openCreateModal = () => {
    setDraftMessage("");
    setSelectedId(null);
    setModalMode("create");
  };

  const openEditModal = (id: string, message: string) => {
    setSelectedId(id);
    setDraftMessage(message);
    setModalMode("edit");
  };

  const openDeleteModal = (id: string) => {
    setSelectedId(id);
    setModalMode("delete");
  };

  const closeModal = () => {
    setModalMode(null);
    setSelectedId(null);
    setDraftMessage("");
  };

  const handleSave = async () => {
    const normalizedMessage = draftMessage.trim();

    if (!normalizedMessage) {
      toast.error("Digite uma mensagem antes de salvar.");
      return;
    }

    if (!isAdmin) {
      toast.error("Você não tem permissão para esta ação.");
      return;
    }

    try {
      if (modalMode === "edit" && selectedId) {
        await updateQuickMessage(selectedId, normalizedMessage);
        toast.success("Mensagem rápida atualizada.");
      } else {
        await createQuickMessage(normalizedMessage);
        toast.success("Mensagem rápida criada.");
      }
      closeModal();
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível salvar a mensagem.");
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;

    if (!isAdmin) {
      toast.error("Você não tem permissão para esta ação.");
      return;
    }

    try {
      await deleteQuickMessage(selectedId);
      toast.success("Mensagem rápida excluída.");
      closeModal();
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível excluir a mensagem.");
    }
  };

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="border-b bg-white px-4 sm:px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <PreTitleIcon icon={MessageSquareTextIcon} />
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Mensagens rápidas
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Administradores gerenciam os atalhos da Empresa. Agentes podem
                apenas consultar e usar na conversa.
              </p>
            </div>
          </div>

          <Button
            type="button"
            onClick={openCreateModal}
            disabled={!isAdmin}
            className="rounded-full"
          >
            <span className="flex items-center gap-2">
              <PlusIcon className="h-4 w-4" />
              Nova mensagem
            </span>
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
        {error ? (
          <Card className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-900">
              Não foi possível carregar
            </h2>
            <p className="mt-2 text-sm text-gray-500">{error}</p>
            <Button
              type="button"
              variant="ghost"
              onClick={refetch}
              className="mt-4"
            >
              Tentar novamente
            </Button>
          </Card>
        ) : loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white"
              />
            ))}
          </div>
        ) : quickMessages.length === 0 ? (
          <Card className="rounded-2xl p-5 sm:p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
              <MessageSquareTextIcon className="h-6 w-6 text-slate-500" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-gray-900">
              Nenhuma mensagem rápida cadastrada
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              Crie frases prontas para agilizar o atendimento da Empresa.
            </p>
            <Button
              type="button"
              onClick={openCreateModal}
              disabled={!isAdmin}
              className="mt-6 rounded-full"
            >
              Criar primeira mensagem
            </Button>
          </Card>
        ) : (
          <div className="space-y-3">
            {quickMessages.map((item) => (
              <Card
                key={item.id}
                className="rounded-2xl border border-slate-200 p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-3xl">
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">
                      {item.message}
                    </p>
                    <p className="mt-3 text-xs text-slate-400">
                      Atualizada em{" "}
                      {new Date(item.updatedAt).toLocaleString("pt-BR")}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!isAdmin}
                      onClick={() => openEditModal(item.id, item.message)}
                    >
                      <span className="flex items-center gap-2">
                        <PencilIcon className="h-4 w-4" />
                        Editar
                      </span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!isAdmin}
                      onClick={() => openDeleteModal(item.id)}
                    >
                      <span className="flex items-center gap-2 text-red-600">
                        <Trash2Icon className="h-4 w-4" />
                        Excluir
                      </span>
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-3 py-4 sm:px-4">
          <div className="max-h-full w-full max-w-2xl overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 sm:p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {modalMode === "create"
                    ? "Nova mensagem rápida"
                    : modalMode === "edit"
                      ? "Editar mensagem rápida"
                      : "Excluir mensagem rápida"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {modalMode === "delete"
                    ? "Essa ação não poderá ser desfeita."
                    : "A mensagem ficará disponível para a Empresa atual na aba anexo do chat."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="text-sm text-slate-500 hover:text-slate-700 border rounded-full p-2"
              >
                <CgClose />
              </button>
            </div>

            {modalMode === "delete" ? (
              <div className="mt-5 space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  {selectedMessage?.message}
                </div>
                <div className="flex items-center justify-end gap-3">
                  <Button type="button" variant="ghost" onClick={closeModal}>
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    onClick={handleDelete}
                    disabled={saving || !isAdmin}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    {saving ? "Excluindo..." : "Excluir"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-800">
                    Mensagem
                  </label>
                  <textarea
                    value={draftMessage}
                    onChange={(event) => setDraftMessage(event.target.value)}
                    rows={6}
                    disabled={!isAdmin}
                    placeholder="Ex: Olá! Tudo bem? Em que posso te ajudar hoje?"
                    className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
                  />
                </div>

                <div className="flex items-center justify-end gap-3">
                  <Button type="button" variant="ghost" onClick={closeModal}>
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !isAdmin}
                    className="rounded-full"
                  >
                    {saving ? "Salvando..." : "Salvar"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
