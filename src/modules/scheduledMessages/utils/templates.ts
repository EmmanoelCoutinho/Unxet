import type {
  MetaTemplateCategory,
  MetaTemplateInput,
  MetaTemplateStatus,
} from "../types/scheduledMessages";

// Mesmas regras de supabase/functions/_shared/metaTemplates.ts (a edge
// function confere de novo antes de mandar para a Meta)

export const TEMPLATE_BODY_MAX = 1024;
export const TEMPLATE_FOOTER_MAX = 60;
export const TEMPLATE_BUTTON_TEXT_MAX = 25;
export const TEMPLATE_BUTTONS_MAX = 3;
export const TEMPLATE_NAME_MAX = 80;
export const TEMPLATE_NAME_FALLBACK = "cliente";

const NAME_TAG = /\{nome\}/gi;
const OTHER_VARIABLE = /\{\{[^}]*\}\}|\{(?!nome\})[^{}\s]*\}/i;

export const validateTemplateDraft = (input: MetaTemplateInput): string | null => {
  const name = input.name.trim();
  const body = input.body.trim();
  const footer = input.footer.trim();
  const buttons = input.buttons.map((b) => b.trim()).filter(Boolean);

  if (!name) return "Dê um nome para o modelo.";
  if (name.length > TEMPLATE_NAME_MAX) {
    return `O nome do modelo pode ter no máximo ${TEMPLATE_NAME_MAX} caracteres.`;
  }
  if (body.length < 10) return "Escreva a mensagem do modelo.";
  if (body.length > TEMPLATE_BODY_MAX) {
    return `A mensagem do modelo pode ter no máximo ${TEMPLATE_BODY_MAX} caracteres.`;
  }
  if (OTHER_VARIABLE.test(body)) {
    return "Use só {nome} como variável. Tire as outras marcações entre chaves.";
  }
  if ((body.match(NAME_TAG) ?? []).length > 1) return "Use {nome} só uma vez na mensagem.";
  if (/^\{nome\}/i.test(body) || /\{nome\}[\s.!?,;:]*$/i.test(body)) {
    return "A Meta não aceita {nome} no começo nem no fim da mensagem. Coloque algum texto antes e depois.";
  }
  if (footer.length > TEMPLATE_FOOTER_MAX) {
    return `O rodapé pode ter no máximo ${TEMPLATE_FOOTER_MAX} caracteres.`;
  }
  if (/[{}]/.test(footer)) return "O rodapé não pode ter variáveis.";
  if (buttons.length > TEMPLATE_BUTTONS_MAX) return `Use no máximo ${TEMPLATE_BUTTONS_MAX} botões.`;
  if (buttons.some((b) => b.length > TEMPLATE_BUTTON_TEXT_MAX)) {
    return `Cada botão pode ter no máximo ${TEMPLATE_BUTTON_TEXT_MAX} caracteres.`;
  }
  if (new Set(buttons.map((b) => b.toLowerCase())).size !== buttons.length) {
    return "Os botões precisam ter textos diferentes.";
  }
  return null;
};

/** Texto do modelo como o cliente recebe (sem nome, a Meta exige um substituto). */
export const renderTemplatePreview = (body: string, name: string | null | undefined) => {
  const value = (name ?? "").trim();
  const resolved = /\p{L}/u.test(value) ? value : TEMPLATE_NAME_FALLBACK;
  return body.replace(NAME_TAG, resolved);
};

export const TEMPLATE_STATUS: Record<
  MetaTemplateStatus,
  { label: string; tone: string; usable: boolean }
> = {
  draft: { label: "Rascunho", tone: "bg-slate-100 text-slate-600", usable: false },
  submitted: { label: "Em análise", tone: "bg-amber-50 text-amber-700", usable: false },
  pending: { label: "Em análise", tone: "bg-amber-50 text-amber-700", usable: false },
  approved: { label: "Aprovado", tone: "bg-green-50 text-green-700", usable: true },
  rejected: { label: "Recusado", tone: "bg-red-50 text-red-700", usable: false },
  paused: { label: "Pausado pela Meta", tone: "bg-orange-50 text-orange-700", usable: false },
  disabled: { label: "Desativado", tone: "bg-slate-100 text-slate-500", usable: false },
  archived: { label: "Arquivado", tone: "bg-slate-100 text-slate-500", usable: false },
};

export const TEMPLATE_CATEGORY_LABEL: Record<MetaTemplateCategory, string> = {
  marketing: "Marketing",
  utility: "Utilidade",
  authentication: "Autenticação",
};

export const TEMPLATE_CATEGORIES: {
  value: "marketing" | "utility";
  label: string;
  description: string;
}[] = [
  {
    value: "marketing",
    label: "Marketing",
    description: "Promoções, novidades, convites e lembretes para voltar.",
  },
  {
    value: "utility",
    label: "Utilidade",
    description: "Avisos sobre algo que o cliente já pediu: agendamento, pedido, pagamento.",
  },
];
