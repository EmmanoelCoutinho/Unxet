// Modelos de mensagem do WhatsApp oficial (Meta) usados nas Campanhas.
// Sem dependência de Deno: testado no Vitest (metaTemplates.test.ts).
//
// Na Unxet o modelo é escrito com {nome}; para a Meta ele vira {{1}} e, no
// envio, o parâmetro 1 recebe o nome do cliente.

export const TEMPLATE_LANGUAGE = "pt_BR";
export const TEMPLATE_BODY_MAX = 1024;
export const TEMPLATE_FOOTER_MAX = 60;
export const TEMPLATE_BUTTON_TEXT_MAX = 25;
export const TEMPLATE_BUTTONS_MAX = 3;
export const TEMPLATE_NAME_MAX = 80;
const BODY_MIN = 10;

// Sem nome cadastrado, a Meta não aceita o parâmetro vazio
export const TEMPLATE_NAME_FALLBACK = "cliente";

export type TemplateCategory = "marketing" | "utility";

export type TemplateStatus =
  | "draft"
  | "submitted"
  | "pending"
  | "approved"
  | "rejected"
  | "paused"
  | "disabled"
  | "archived";

export type TemplateInput = {
  name: string;
  category: TemplateCategory;
  body: string;
  footer?: string | null;
  buttons?: string[] | null;
};

const NAME_TAG = /\{nome\}/gi;
// Qualquer outra marcação entre chaves (a Meta usaria como variável)
const OTHER_VARIABLE = /\{\{[^}]*\}\}|\{(?!nome\})[^{}\s]*\}/i;

const usableName = (name: unknown) => {
  const value = typeof name === "string" ? name.trim() : "";
  return /\p{L}/u.test(value) ? value : "";
};

export const templateUsesName = (body: string) => /\{nome\}/i.test(body ?? "");

/** Limpa o que a pessoa digitou: espaços nas pontas e botões vazios. */
export const normalizeTemplateInput = (input: TemplateInput): TemplateInput => ({
  name: String(input.name ?? "").trim(),
  category: input.category,
  body: String(input.body ?? "").trim(),
  footer: String(input.footer ?? "").trim() || null,
  buttons: (input.buttons ?? [])
    .map((b) => String(b ?? "").trim())
    .filter(Boolean),
});

/** Regras da Meta conferidas antes de enviar. Devolve o erro ou null. */
export const validateTemplateInput = (raw: TemplateInput): string | null => {
  const input = normalizeTemplateInput(raw);

  if (!input.name) return "Dê um nome para o modelo.";
  if (input.name.length > TEMPLATE_NAME_MAX) {
    return `O nome do modelo pode ter no máximo ${TEMPLATE_NAME_MAX} caracteres.`;
  }
  if (input.category !== "marketing" && input.category !== "utility") {
    return "Escolha o tipo do modelo.";
  }

  const body = input.body;
  if (body.length < BODY_MIN) return "Escreva a mensagem do modelo.";
  if (body.length > TEMPLATE_BODY_MAX) {
    return `A mensagem do modelo pode ter no máximo ${TEMPLATE_BODY_MAX} caracteres.`;
  }
  if (OTHER_VARIABLE.test(body)) {
    return "Use só {nome} como variável. Tire as outras marcações entre chaves.";
  }
  const nameCount = (body.match(NAME_TAG) ?? []).length;
  if (nameCount > 1) return "Use {nome} só uma vez na mensagem.";
  if (/^\{nome\}/i.test(body) || /\{nome\}[\s.!?,;:]*$/i.test(body)) {
    return "A Meta não aceita {nome} no começo nem no fim da mensagem. Coloque algum texto antes e depois.";
  }

  const footer = input.footer ?? "";
  if (footer.length > TEMPLATE_FOOTER_MAX) {
    return `O rodapé pode ter no máximo ${TEMPLATE_FOOTER_MAX} caracteres.`;
  }
  if (/[{}]/.test(footer)) return "O rodapé não pode ter variáveis.";

  const buttons = input.buttons ?? [];
  if (buttons.length > TEMPLATE_BUTTONS_MAX) {
    return `Use no máximo ${TEMPLATE_BUTTONS_MAX} botões.`;
  }
  if (buttons.some((b) => b.length > TEMPLATE_BUTTON_TEXT_MAX)) {
    return `Cada botão pode ter no máximo ${TEMPLATE_BUTTON_TEXT_MAX} caracteres.`;
  }
  if (new Set(buttons.map((b) => b.toLowerCase())).size !== buttons.length) {
    return "Os botões precisam ter textos diferentes.";
  }

  return null;
};

/**
 * Nome técnico do modelo na Meta: minúsculas, números e "_". O sufixo
 * aleatório evita colisão com outro modelo da mesma conta (a Meta não deixa
 * reaproveitar o nome de um modelo apagado por 30 dias).
 */
export const toMetaTemplateName = (name: string, suffix: string) => {
  const base = String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  const cleanSuffix = String(suffix ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return [base || "modelo", cleanSuffix].filter(Boolean).join("_");
};

/** Componentes do POST /{waba_id}/message_templates. */
export const buildTemplateComponents = (raw: TemplateInput) => {
  const input = normalizeTemplateInput(raw);
  const usesName = templateUsesName(input.body);
  const components: Record<string, unknown>[] = [
    {
      type: "BODY",
      text: input.body.replace(NAME_TAG, "{{1}}"),
      ...(usesName ? { example: { body_text: [["Maria"]] } } : {}),
    },
  ];
  if (input.footer) components.push({ type: "FOOTER", text: input.footer });
  if (input.buttons && input.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: input.buttons.map((text) => ({ type: "QUICK_REPLY", text })),
    });
  }
  return components;
};

/** Status da Meta (criação, listagem ou webhook) para o status da Unxet. */
export const mapMetaTemplateStatus = (value: unknown): TemplateStatus | null => {
  switch (String(value ?? "").trim().toUpperCase()) {
    case "APPROVED":
    case "REINSTATED":
      return "approved";
    case "PENDING":
    case "IN_APPEAL":
    case "APPEAL_REQUESTED":
      return "pending";
    case "REJECTED":
      return "rejected";
    case "PAUSED":
    case "FLAGGED":
      return "paused";
    case "DISABLED":
    case "DELETED":
    case "PENDING_DELETION":
    case "ARCHIVED":
      return "disabled";
    default:
      return null;
  }
};

const REJECTION_REASONS: Record<string, string> = {
  ABUSIVE_CONTENT: "A Meta considerou o conteúdo abusivo.",
  INVALID_FORMAT: "O formato não segue as regras da Meta (variáveis, tamanho ou caracteres).",
  PROMOTIONAL: "A Meta entendeu que é uma mensagem de marketing. Crie de novo com o tipo Marketing.",
  TAG_CONTENT_MISMATCH: "O tipo escolhido não combina com o texto. Confira se é Marketing ou Utilidade.",
  SCAM: "A Meta considerou o conteúdo enganoso.",
  INCORRECT_CATEGORY: "O tipo escolhido não combina com o texto. Confira se é Marketing ou Utilidade.",
};

/** Motivo da recusa em português (o que vier sem tradução é mostrado como veio). */
export const describeRejection = (reason: unknown): string | null => {
  const raw = String(reason ?? "").trim();
  if (!raw || raw.toUpperCase() === "NONE") return null;
  return REJECTION_REASONS[raw.toUpperCase()] ?? raw;
};

/** Mensagem de erro da Graph API para mostrar na tela. */
export const describeMetaError = (body: any, fallback: string) => {
  const err = body?.error ?? {};
  const text =
    String(err.error_user_msg ?? "").trim() ||
    String(err.error_user_title ?? "").trim() ||
    String(err.message ?? "").trim();
  return text ? `${fallback} ${text.slice(0, 300)}` : fallback;
};

/** Texto que o cliente recebe (com o nome, ou o substituto). */
export const renderTemplateText = (body: string, name: unknown) =>
  String(body ?? "").replace(NAME_TAG, usableName(name) || TEMPLATE_NAME_FALLBACK);

/** Corpo do POST /{phone_number_id}/messages para enviar o modelo. */
export const buildTemplateMessage = (params: {
  to: string;
  metaTemplateName: string;
  languageCode: string;
  body: string;
  name: unknown;
}) => {
  const usesName = templateUsesName(params.body);
  return {
    messaging_product: "whatsapp",
    to: params.to,
    type: "template",
    template: {
      name: params.metaTemplateName,
      language: { code: params.languageCode || TEMPLATE_LANGUAGE },
      ...(usesName
        ? {
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: usableName(params.name) || TEMPLATE_NAME_FALLBACK },
                ],
              },
            ],
          }
        : {}),
    },
  };
};

/**
 * Falha no envio de um modelo, em texto curto. Os começos dos textos importam:
 * failure_kind (migration 20261025000000) usa "Este número não tem WhatsApp"
 * para não tentar de novo.
 */
export const describeTemplateSendError = (status: number, body: any) => {
  const err = body?.error ?? {};
  const code = Number(err.code ?? 0);
  switch (code) {
    case 131026:
      return "Este número não tem WhatsApp ou não pode receber mensagens.";
    case 131049:
      return "A Meta segurou a mensagem para não cansar o cliente com marketing. Tente de novo em outro dia.";
    case 131050:
      return "Este número não tem WhatsApp liberado para marketing: o cliente pediu para não receber essas mensagens.";
    case 132000:
    case 132001:
    case 132005:
    case 132007:
    case 132012:
    case 132015:
    case 132016:
      return "O modelo não está disponível na Meta (pausado, apagado ou alterado). Confira em Modelos da Meta.";
    case 190:
      return "A conexão do WhatsApp oficial expirou. Reconecte o número em Integrações.";
    case 131056:
    case 130429:
    case 80007:
      return "A Meta pediu para enviar mais devagar. Tente de novo.";
    default: {
      const text = String(err.error_data?.details ?? err.message ?? "").trim();
      return text ? `Falha no envio: ${text.slice(0, 200)}` : `Falha no envio (código ${status}).`;
    }
  }
};
