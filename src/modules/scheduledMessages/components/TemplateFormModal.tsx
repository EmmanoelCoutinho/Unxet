import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { InfoIcon, PlusIcon, SendIcon, Trash2Icon, UserPlusIcon } from "lucide-react";
import { toast } from "react-toastify";
import { CloseButton } from "../../../components/ui/CloseButton";
import type { MetaTemplateInput } from "../types/scheduledMessages";
import {
  TEMPLATE_BODY_MAX,
  TEMPLATE_BUTTONS_MAX,
  TEMPLATE_BUTTON_TEXT_MAX,
  TEMPLATE_CATEGORIES,
  TEMPLATE_FOOTER_MAX,
  TEMPLATE_NAME_MAX,
  renderTemplatePreview,
  validateTemplateDraft,
} from "../utils/templates";
import { WhatsappPreview } from "./WhatsappPreview";

const FIELD =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100";
const LABEL = "block text-sm font-medium text-slate-800";
const HINT = "mt-1.5 text-xs leading-5 text-slate-500";

/**
 * Cria um modelo de mensagem e envia para a Meta aprovar. A aprovação costuma
 * levar de minutos a algumas horas; o status aparece na lista de modelos.
 */
export const TemplateFormModal: React.FC<{
  initialName?: string;
  saving: boolean;
  onSubmit: (input: MetaTemplateInput) => Promise<void>;
  onClose: () => void;
}> = ({ initialName = "", saving, onSubmit, onClose }) => {
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState<"marketing" | "utility">("marketing");
  const [body, setBody] = useState("");
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<string[]>([]);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const pendingCursor = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  // Cursor depois de inserir {nome} (só depois que o texto novo está no campo)
  useLayoutEffect(() => {
    const cursor = pendingCursor.current;
    const textarea = bodyRef.current;
    if (cursor === null || !textarea) return;
    pendingCursor.current = null;
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
  }, [body]);

  const insertName = () => {
    if (/\{nome\}/i.test(body)) {
      toast.info("O nome do cliente já está na mensagem.");
      return;
    }
    const textarea = bodyRef.current;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    const next = body.slice(0, start) + "{nome}" + body.slice(end);
    if (next.length > TEMPLATE_BODY_MAX) {
      toast.error("A mensagem já está no tamanho máximo.");
      return;
    }
    pendingCursor.current = start + "{nome}".length;
    setBody(next);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const input = { name, category, body, footer, buttons };
    const error = validateTemplateDraft(input);
    if (error) {
      toast.error(error);
      return;
    }
    await onSubmit({
      name: name.trim(),
      category,
      body: body.trim(),
      footer: footer.trim(),
      buttons: buttons.map((b) => b.trim()).filter(Boolean),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-3 py-4 sm:px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Novo modelo da Meta"
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-lg"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">Novo modelo da Meta</h2>
            <p className="mt-1 text-sm text-slate-500">
              Pelo WhatsApp oficial, campanhas só saem com um modelo aprovado pela Meta.
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-5">
              <div>
                <label htmlFor="template-name" className={LABEL}>
                  Nome do modelo
                </label>
                <input
                  id="template-name"
                  type="text"
                  autoFocus
                  value={name}
                  maxLength={TEMPLATE_NAME_MAX}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ex.: Promoção de novembro"
                  className={`${FIELD} mt-1.5`}
                />
                <p className={HINT}>Só a equipe vê. Ajuda a achar o modelo na hora de criar a campanha.</p>
              </div>

              <fieldset>
                <legend className={LABEL}>Tipo</legend>
                <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {TEMPLATE_CATEGORIES.map((option) => {
                    const active = category === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setCategory(option.value)}
                        aria-pressed={active}
                        className={`rounded-xl border p-3 text-left transition ${
                          active
                            ? "border-blue-500 bg-blue-50/70 ring-4 ring-blue-100"
                            : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <span className={`block text-sm font-semibold ${active ? "text-blue-800" : "text-slate-800"}`}>
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-slate-500">{option.description}</span>
                      </button>
                    );
                  })}
                </div>
                <p className={HINT}>Se o tipo não combinar com o texto, a Meta recusa ou troca o tipo.</p>
              </fieldset>

              <div>
                <div className="flex items-end justify-between gap-3">
                  <label htmlFor="template-body" className={LABEL}>
                    Mensagem
                  </label>
                  <span className="text-xs text-slate-400">
                    {body.length}/{TEMPLATE_BODY_MAX}
                  </span>
                </div>
                <textarea
                  id="template-body"
                  ref={bodyRef}
                  value={body}
                  rows={7}
                  maxLength={TEMPLATE_BODY_MAX}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Ex.: Olá {nome}! Em novembro todos os serviços estão com 20% de desconto. Responda esta mensagem para agendar."
                  className={`${FIELD} mt-1.5 resize-y leading-6`}
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={insertName}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                  >
                    <UserPlusIcon className="h-3.5 w-3.5" />
                    Inserir nome do cliente
                  </button>
                  <span className="text-xs text-slate-500">
                    Uma vez, no meio do texto. Sem nome cadastrado, vira “cliente”.
                  </span>
                </div>
              </div>

              <div>
                <label htmlFor="template-footer" className={LABEL}>
                  Rodapé <span className="font-normal text-slate-400">(opcional)</span>
                </label>
                <input
                  id="template-footer"
                  type="text"
                  value={footer}
                  maxLength={TEMPLATE_FOOTER_MAX}
                  onChange={(event) => setFooter(event.target.value)}
                  placeholder="Ex.: Responda SAIR para não receber mais"
                  className={`${FIELD} mt-1.5`}
                />
              </div>

              <div>
                <p className={LABEL}>
                  Botões de resposta <span className="font-normal text-slate-400">(opcional)</span>
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  O cliente toca no botão e a resposta chega na conversa.
                </p>
                <div className="mt-2 space-y-2">
                  {buttons.map((label, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={label}
                        maxLength={TEMPLATE_BUTTON_TEXT_MAX}
                        onChange={(event) =>
                          setButtons((list) => list.map((b, i) => (i === index ? event.target.value : b)))
                        }
                        // Só monta quando a pessoa adiciona o botão: o cursor já vai para ele
                        autoFocus
                        placeholder={index === 0 ? "Ex.: Quero agendar" : "Ex.: Agora não"}
                        aria-label={`Botão ${index + 1}`}
                        className={FIELD}
                      />
                      <button
                        type="button"
                        onClick={() => setButtons((list) => list.filter((_, i) => i !== index))}
                        className="rounded-full p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                        aria-label={`Remover botão ${index + 1}`}
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  {buttons.length < TEMPLATE_BUTTONS_MAX && (
                    <button
                      type="button"
                      onClick={() => setButtons((list) => [...list, ""])}
                      className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-blue-300 hover:text-blue-700"
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                      Adicionar botão
                    </button>
                  )}
                </div>
              </div>
            </div>

            <aside className="space-y-3">
              <WhatsappPreview
                title="Prévia"
                text={renderTemplatePreview(body, "Maria")}
                time={new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                footer={footer}
                buttons={buttons}
              />
              <div className="flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                <InfoIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                <p>
                  A Meta costuma responder em minutos, às vezes em algumas horas. Depois de enviado, o texto não
                  pode ser alterado: para mudar, crie outro modelo.
                </p>
              </div>
            </aside>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-5 py-3 sm:px-6">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
            >
              <SendIcon className="h-4 w-4" />
              {saving ? "Enviando para a Meta..." : "Enviar para aprovação"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
