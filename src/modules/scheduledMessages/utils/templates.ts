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

export type TemplateFieldErrors = {
  name?: string;
  body?: string;
  footer?: string;
  /** Erro de um botão, pelo índice dele na lista */
  buttons?: Record<number, string>;
  /** Erro do conjunto de botões (quantidade, repetidos) */
  buttonsGroup?: string;
};

/**
 * Confere o modelo e devolve o erro de cada campo, para mostrar ao lado dele.
 * Objeto vazio: tudo certo.
 */
export const validateTemplateFields = (input: MetaTemplateInput): TemplateFieldErrors => {
  const errors: TemplateFieldErrors = {};
  const name = input.name.trim();
  const body = input.body.trim();
  const footer = input.footer.trim();

  if (!name) errors.name = "Dê um nome para o modelo.";
  else if (name.length > TEMPLATE_NAME_MAX) {
    errors.name = `O nome do modelo pode ter no máximo ${TEMPLATE_NAME_MAX} caracteres.`;
  }

  if (body.length < 10) {
    errors.body = body ? "A mensagem precisa ter pelo menos 10 caracteres." : "Escreva a mensagem do modelo.";
  } else if (body.length > TEMPLATE_BODY_MAX) {
    errors.body = `A mensagem do modelo pode ter no máximo ${TEMPLATE_BODY_MAX} caracteres.`;
  } else if (OTHER_VARIABLE.test(body)) {
    errors.body = "Use só {nome} como variável. Tire as outras marcações entre chaves.";
  } else if ((body.match(NAME_TAG) ?? []).length > 1) {
    errors.body = "Use {nome} só uma vez na mensagem.";
  } else if (/^{nome}/i.test(body) || /{nome}[s.!?,;:]*$/i.test(body)) {
    errors.body = "A Meta não aceita {nome} no começo nem no fim da mensagem. Coloque algum texto antes e depois.";
  }

  if (footer.length > TEMPLATE_FOOTER_MAX) {
    errors.footer = `O rodapé pode ter no máximo ${TEMPLATE_FOOTER_MAX} caracteres.`;
  } else if (/[{}]/.test(footer)) {
    errors.footer = "O rodapé não pode ter variáveis.";
  }

  const buttonErrors: Record<number, string> = {};
  const seen = new Map<string, number>();
  input.buttons.forEach((raw, index) => {
    const text = raw.trim();
    if (!text) {
      buttonErrors[index] = "Escreva o texto do botão ou remova o botão.";
    } else if (text.length > TEMPLATE_BUTTON_TEXT_MAX) {
      buttonErrors[index] = `O botão pode ter no máximo ${TEMPLATE_BUTTON_TEXT_MAX} caracteres.`;
    } else if (seen.has(text.toLowerCase())) {
      buttonErrors[index] = "Este botão repete o texto de outro.";
    } else {
      seen.set(text.toLowerCase(), index);
    }
  });
  if (Object.keys(buttonErrors).length > 0) errors.buttons = buttonErrors;
  if (input.buttons.length > TEMPLATE_BUTTONS_MAX) {
    errors.buttonsGroup = `Use no máximo ${TEMPLATE_BUTTONS_MAX} botões.`;
  }

  return errors;
};

export const hasTemplateErrors = (errors: TemplateFieldErrors) =>
  Boolean(errors.name || errors.body || errors.footer || errors.buttons || errors.buttonsGroup);

/** Primeiro erro do modelo, ou null. */
export const validateTemplateDraft = (input: MetaTemplateInput): string | null => {
  const errors = validateTemplateFields(input);
  return (
    errors.name ??
    errors.body ??
    errors.footer ??
    errors.buttonsGroup ??
    Object.values(errors.buttons ?? {})[0] ??
    null
  );
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
