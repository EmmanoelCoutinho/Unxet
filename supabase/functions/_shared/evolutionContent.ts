// Conteúdo de uma mensagem recebida pela Evolution (WhatsApp via QR Code).
//
// O WhatsApp embrulha muitas mensagens: temporárias (ephemeralMessage), de
// visualização única (viewOnceMessage*), fotos de álbum
// (associatedChildMessage), figurinha animada (lottieStickerMessage)... O
// conteúdo de verdade fica em <embrulho>.message. Sem desembrulhar, a foto de
// um álbum virava "[Mensagem em um formato que o Unxet ainda não exibe]".
import { stickerHash } from "./stickerStore.ts";

export const UNSUPPORTED_TEXT =
  "[Mensagem em um formato que o Unxet ainda não exibe. Peça ao cliente para reenviar como texto, foto ou documento.]";
export const UNSUPPORTED_TEXT_FROM_ME =
  "[Mensagem enviada pelo celular em um formato que o Unxet ainda não exibe. Veja no WhatsApp do celular.]";

// Embrulhos com o conteúdo em .message (editedMessage fica de fora: a edição
// é tratada antes, corrigindo a mensagem original)
const WRAPPER_KEYS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "associatedChildMessage",
  "lottieStickerMessage",
  "botInvokeMessage",
  "groupMentionedMessage",
  "statusMentionMessage",
  "futureProofMessage",
  "deviceSentMessage",
];

// Campos de controle que acompanham qualquer mensagem
const ENVELOPE_KEYS = ["messageContextInfo", "senderKeyDistributionMessage"];

// Eventos sem conteúdo para o atendente. albumMessage é só o aviso de que vem
// um álbum (as fotos chegam depois, uma a uma); secretEncryptedMessage é uma
// edição criptografada, que a Evolution não abre.
const PROTOCOL_KEYS = [
  "protocolMessage",
  "pollUpdateMessage",
  "keepInChatMessage",
  "pinInChatMessage",
  "encReactionMessage",
  "encEventResponseMessage",
  "eventResponseMessage",
  "albumMessage",
  "secretEncryptedMessage",
  "messageHistoryBundle",
];

const contentKeys = (message: any) =>
  Object.keys(message ?? {}).filter((key) => !ENVELOPE_KEYS.includes(key));

/** Tira os embrulhos até chegar ao conteúdo (até 5 níveis). */
export function unwrapEvolutionMessage(message: any): any {
  let current = message ?? {};
  for (let depth = 0; depth < 5; depth++) {
    const wrapper = WRAPPER_KEYS.find((key) => current?.[key]?.message);
    if (!wrapper) break;
    current = current[wrapper].message;
  }
  return current ?? {};
}

const VIEW_ONCE_KEYS = ["viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension"];
const VIEW_ONCE_MEDIA_KEYS = ["imageMessage", "videoMessage", "audioMessage", "ptvMessage"];

/**
 * Foto, vídeo ou áudio de visualização única. O WhatsApp não entrega o
 * arquivo aos aparelhos conectados (nem o WhatsApp Web mostra): não é gravada.
 * O embrulho viewOnceMessage também carrega botões e listas, que continuam.
 */
export function isViewOnceMedia(message: any): boolean {
  let current = message ?? {};
  let insideViewOnce = false;
  for (let depth = 0; depth < 6; depth++) {
    const media = VIEW_ONCE_MEDIA_KEYS.find((key) => current?.[key]);
    if (media) return insideViewOnce || current[media]?.viewOnce === true;
    const wrapper = WRAPPER_KEYS.find((key) => current?.[key]?.message);
    if (!wrapper) return false;
    if (VIEW_ONCE_KEYS.includes(wrapper)) insideViewOnce = true;
    current = current[wrapper].message;
  }
  return false;
}

/** Evento sem conteúdo para o atendente (apagar mensagem, voto em enquete, álbum...). */
export function isProtocolOnlyMessage(message: any): boolean {
  const keys = contentKeys(unwrapEvolutionMessage(message));
  if (keys.length === 0) return true;
  return keys.every((key) => PROTOCOL_KEYS.includes(key));
}

export interface EvolutionContent {
  messageType: "text" | "image" | "sticker" | "audio" | "document" | "interactive";
  text: string;
  interactive?: { kind: string; selectedId: string | null; selectedTitle: string | null };
  needsMediaFetch: boolean;
  /** Mensagem (já desembrulhada) que vai para o download da mídia na Evolution. */
  mediaMessage?: Record<string, any>;
  fallbackFilename?: string;
  fallbackMimeType?: string;
  /** Figurinha: SHA-256 do arquivo, para guardar uma vez só (stickerStore.ts). */
  stickerHash?: string | null;
  /** Tipo de mensagem não tratado (para o log). */
  unsupported?: string[];
}

const clean = (value: unknown) => String(value ?? "").trim();
const joinLines = (lines: unknown[]) =>
  lines.map(clean).filter(Boolean).join("\n");
const bold = (value: unknown) => (clean(value) ? `*${clean(value)}*` : "");
const italic = (value: unknown) => (clean(value) ? `_${clean(value)}_` : "");

function parseJson(raw: unknown): any {
  try {
    return JSON.parse(String(raw ?? ""));
  } catch {
    return null;
  }
}

/** Mídia que vem no cabeçalho de modelos, botões e mensagens interativas. */
function headerMedia(holder: any): Pick<EvolutionContent, "messageType" | "mediaMessage"> | null {
  if (holder?.imageMessage) return { messageType: "image", mediaMessage: { imageMessage: holder.imageMessage } };
  if (holder?.documentMessage) return { messageType: "document", mediaMessage: { documentMessage: holder.documentMessage } };
  if (holder?.videoMessage) return { messageType: "document", mediaMessage: { videoMessage: holder.videoMessage } };
  return null;
}

/** Botões nativos (quick_reply, cta_url, cta_copy, cta_call...). Pagamento fica de fora. */
// Botões de pagamento (Pix): o conteúdo sai em pixText, não como botão
const isPaymentButton = (button: any) => /^(payment_|review_)/.test(clean(button?.name));

const PIX_KEY_TYPES: Record<string, string> = {
  CPF: "CPF",
  CNPJ: "CNPJ",
  PHONE: "Telefone",
  EMAIL: "E-mail",
  EVP: "Chave aleatória",
};

/**
 * Pix enviado pelo WhatsApp (botão nativo payment_request/payment_info):
 * - código copia e cola (pix_dynamic_code / copy_code): só o código, para o
 *   "Copiar" da mensagem pegar exatamente o que se cola no banco;
 * - chave (pix_static_code): "Chave Pix (CNPJ): ..." e o nome do recebedor.
 * O valor vai junto quando vier.
 */
function pixText(buttons: any[]): { code?: string; text: string } | null {
  for (const button of buttons ?? []) {
    if (!isPaymentButton(button)) continue;
    const params = parseJson(button?.buttonParamsJson) ?? {};
    const settings = [
      params.payment_setting,
      ...(Array.isArray(params.payment_settings) ? params.payment_settings : []),
    ].filter(Boolean);
    const amount = Number(params.total_amount?.value);
    const offset = Number(params.total_amount?.offset ?? 100);
    const value = Number.isFinite(amount) && amount > 0 && offset > 0
      ? moneyText((amount / offset) * 1000, params.currency ?? "BRL")
      : "";
    const valueLine = value ? "Valor: " + value : "";

    const dynamic = settings.find((item: any) => item?.pix_dynamic_code?.code)?.pix_dynamic_code;
    const code = clean(dynamic?.code ?? params.copy_code);
    if (code) return { code, text: joinLines([valueLine, code]) };

    const pixKey = settings.find((item: any) => item?.pix_static_code?.key)?.pix_static_code;
    if (pixKey) {
      const type = PIX_KEY_TYPES[clean(pixKey.key_type).toUpperCase()];
      return {
        text: joinLines([
          "Chave Pix" + (type ? " (" + type + ")" : "") + ": " + clean(pixKey.key),
          clean(pixKey.merchant_name),
          valueLine,
        ]),
      };
    }
  }
  return null;
}

function nativeFlowButtons(buttons: any[]): string[] {
  return (buttons ?? []).flatMap((button) => {
    if (isPaymentButton(button)) return [];
    const params = parseJson(button?.buttonParamsJson) ?? {};
    const label = clean(params.display_text ?? params.title);
    if (!label) return [];
    const extra = clean(params.url ?? params.copy_code ?? params.phone_number);
    return [`🔘 ${label}${extra ? ` - ${extra}` : ""}`];
  });
}

function hydratedButtons(buttons: any[]): string[] {
  return (buttons ?? []).flatMap((button) => {
    const quick = button?.quickReplyButton;
    const url = button?.urlButton;
    const call = button?.callButton;
    if (quick?.displayText) return [`🔘 ${clean(quick.displayText)}`];
    if (url?.displayText) return [`🔘 ${clean(url.displayText)}${url.url ? ` - ${clean(url.url)}` : ""}`];
    if (call?.displayText) return [`🔘 ${clean(call.displayText)}${call.phoneNumber ? ` - ${clean(call.phoneNumber)}` : ""}`];
    return [];
  });
}

function listText(list: any): string {
  const sections = (list?.sections ?? []).map((section: any) =>
    joinLines([
      bold(section?.title),
      ...(section?.rows ?? []).map((row: any) => {
        const title = clean(row?.title);
        const description = clean(row?.description);
        if (!title && !description) return "";
        return `• ${title}${title && description ? " - " : ""}${description}`;
      }),
    ]),
  );
  return [
    joinLines([bold(list?.title), list?.description]),
    ...sections,
    joinLines([list?.buttonText ? `📋 ${clean(list.buttonText)}` : "", italic(list?.footerText)]),
  ].filter(Boolean).join("\n\n");
}

function interactiveText(msg: any): string {
  const pix = pixText(msg?.nativeFlowMessage?.buttons);
  const body = clean(msg?.body?.text);
  return [
    joinLines([bold(msg?.header?.title), msg?.header?.subtitle]),
    // O corpo do Pix copia e cola costuma ser o próprio código: não repete
    pix?.code && body === pix.code ? "" : body,
    pix?.text ?? "",
    joinLines(nativeFlowButtons(msg?.nativeFlowMessage?.buttons)),
    italic(msg?.footer?.text),
  ].filter(Boolean).join("\n\n");
}

function templateText(template: any): string {
  return [
    bold(template?.hydratedTitleText),
    clean(template?.hydratedContentText),
    joinLines(hydratedButtons(template?.hydratedButtons)),
    italic(template?.hydratedFooterText),
  ].filter(Boolean).join("\n\n");
}

function moneyText(amount1000: unknown, currency: unknown): string {
  const value = Number(amount1000);
  if (!Number.isFinite(value) || value <= 0) return "";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: clean(currency) || "BRL" }).format(value / 1000);
  } catch {
    return (value / 1000).toFixed(2);
  }
}

function eventDate(seconds: unknown): string {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "";
  return new Date(value * 1000).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * Tipo, texto e se precisa baixar mídia. fromMe: mensagem enviada pelo
 * celular da empresa (o aviso de formato não pede para o cliente reenviar).
 */
export function parseEvolutionContent(
  rawMessage: any,
  providerMessageId: string,
  { fromMe = false }: { fromMe?: boolean } = {},
): EvolutionContent {
  const msg = unwrapEvolutionMessage(rawMessage);
  const media = (
    messageType: EvolutionContent["messageType"],
    text: unknown,
    extra: Partial<EvolutionContent> = {},
  ): EvolutionContent => ({ messageType, text: clean(text), needsMediaFetch: true, mediaMessage: msg, ...extra });
  const plain = (text: string): EvolutionContent => ({ messageType: "text", text, needsMediaFetch: false });
  const reply = (selectedId: unknown, selectedTitle: unknown): EvolutionContent => {
    const interactive = {
      kind: "button_reply",
      selectedId: clean(selectedId) || null,
      selectedTitle: clean(selectedTitle) || null,
    };
    return {
      messageType: "interactive",
      text: interactive.selectedTitle ?? interactive.selectedId ?? "",
      interactive,
      needsMediaFetch: false,
    };
  };

  if (msg.conversation != null || msg.extendedTextMessage) {
    return plain(String(msg.conversation ?? msg.extendedTextMessage?.text ?? ""));
  }
  if (msg.imageMessage) return media("image", msg.imageMessage.caption);
  if (msg.stickerMessage) {
    // Figurinha: webp (a animada também abre no navegador), sem balão na conversa
    return media("sticker", "", {
      fallbackFilename: `figurinha-${providerMessageId}.webp`,
      fallbackMimeType: msg.stickerMessage.mimetype ?? "image/webp",
      stickerHash: stickerHash(msg.stickerMessage),
    });
  }
  if (msg.audioMessage || msg.pttMessage) return media("audio", "");
  if (msg.documentMessage || msg.documentWithCaptionMessage) {
    const doc = msg.documentMessage ?? msg.documentWithCaptionMessage?.message?.documentMessage;
    return media("document", doc?.caption);
  }
  if (msg.videoMessage || msg.ptvMessage) {
    // Vídeo (e vídeo redondo) chega como anexo: o chat exibe pelo tipo do arquivo
    const video = msg.videoMessage ?? msg.ptvMessage;
    return media("document", video.caption, {
      mediaMessage: { videoMessage: video },
      fallbackFilename: `video-${providerMessageId}.mp4`,
      fallbackMimeType: video.mimetype ?? "video/mp4",
    });
  }

  // ── Respostas a botões e listas ─────────────────────────────────────────
  if (msg.buttonsResponseMessage) {
    const r = msg.buttonsResponseMessage;
    const out = reply(r.selectedButtonId, r.selectedDisplayText);
    return out;
  }
  if (msg.listResponseMessage) {
    const r = msg.listResponseMessage;
    const out = reply(r.singleSelectReply?.selectedRowId, r.title);
    out.interactive!.kind = "list_reply";
    return out;
  }
  if (msg.templateButtonReplyMessage) {
    const r = msg.templateButtonReplyMessage;
    return reply(r.selectedId ?? String(r.selectedIndex ?? ""), r.selectedDisplayText);
  }
  if (msg.interactiveResponseMessage) {
    const r = msg.interactiveResponseMessage;
    const params = parseJson(r.nativeFlowResponseMessage?.paramsJson) ?? {};
    return reply(params.id ?? params.selectedId, r.body?.text ?? params.display_text ?? params.title);
  }

  // ── Mensagens com botões/lista (em geral, robôs de outras empresas) ─────
  if (msg.listMessage) return plain(listText(msg.listMessage) || "📋 Lista de opções");
  if (msg.buttonsMessage) {
    const b = msg.buttonsMessage;
    const text = [
      clean(b.text),
      clean(b.contentText),
      joinLines((b.buttons ?? []).map((btn: any) => (btn?.buttonText?.displayText ? `🔘 ${clean(btn.buttonText.displayText)}` : ""))),
      italic(b.footerText),
    ].filter(Boolean).join("\n\n");
    const header = headerMedia(b);
    return header ? media(header.messageType, text, header) : plain(text || "🔘 Mensagem com botões");
  }
  if (msg.templateMessage) {
    const t = msg.templateMessage;
    const hydrated = t.hydratedTemplate ?? t.hydratedFourRowTemplate ?? t.fourRowTemplate;
    if (hydrated) {
      const text = templateText(hydrated);
      const header = headerMedia(hydrated);
      return header ? media(header.messageType, text, header) : plain(text || "📄 Modelo de mensagem");
    }
    if (t.interactiveMessageTemplate) {
      const text = interactiveText(t.interactiveMessageTemplate);
      const header = headerMedia(t.interactiveMessageTemplate.header);
      return header ? media(header.messageType, text, header) : plain(text || "📄 Modelo de mensagem");
    }
  }
  if (msg.interactiveMessage) {
    const text = interactiveText(msg.interactiveMessage);
    const header = headerMedia(msg.interactiveMessage.header);
    return header ? media(header.messageType, text, header) : plain(text || "🔘 Mensagem com botões");
  }

  // ── Outros conteúdos que viram texto ────────────────────────────────────
  if (msg.locationMessage || msg.liveLocationMessage) {
    const loc = msg.locationMessage ?? msg.liveLocationMessage;
    const place = [loc.name, loc.address].filter(Boolean).join(" - ");
    const hasCoords = Number.isFinite(Number(loc.degreesLatitude)) && Number.isFinite(Number(loc.degreesLongitude));
    return plain(joinLines([
      `📍 ${msg.liveLocationMessage ? "Localização em tempo real" : "Localização"}${place ? `: ${place}` : ""}`,
      hasCoords ? `https://maps.google.com/?q=${loc.degreesLatitude},${loc.degreesLongitude}` : "",
    ]));
  }
  if (msg.contactMessage || msg.contactsArrayMessage) {
    const contacts = msg.contactMessage ? [msg.contactMessage] : msg.contactsArrayMessage?.contacts ?? [];
    const text = contacts.map((c: any) => {
      const phone = String(c?.vcard ?? "").match(/TEL[^:]*:([+\d\s().-]+)/i)?.[1]?.trim();
      return `👤 Contato: ${c?.displayName ?? "sem nome"}` + (phone ? ` - ${phone}` : "");
    }).join("\n");
    return plain(text || "👤 Contato compartilhado");
  }
  const poll = msg.pollCreationMessage ?? msg.pollCreationMessageV2 ?? msg.pollCreationMessageV3 ?? msg.pollCreationMessageV5;
  if (poll) {
    return plain(joinLines([
      `📊 Enquete: ${clean(poll.name)}`.trim(),
      ...(poll.options ?? []).map((o: any) => (clean(o?.optionName) ? `• ${clean(o.optionName)}` : "")),
    ]));
  }
  if (msg.eventMessage) {
    const e = msg.eventMessage;
    const location = clean(e.location?.name ?? e.location?.address);
    return plain(joinLines([
      `📅 Evento: ${clean(e.name)}`.trim(),
      clean(e.description),
      eventDate(e.startTime) ? `Início: ${eventDate(e.startTime)}` : "",
      location ? `Local: ${location}` : "",
      e.joinLink ? clean(e.joinLink) : "",
    ]));
  }
  if (msg.groupInviteMessage) {
    const g = msg.groupInviteMessage;
    return plain(joinLines([
      `👥 Convite para o grupo ${clean(g.groupName)}`.trim(),
      clean(g.caption),
      g.inviteCode ? `https://chat.whatsapp.com/${clean(g.inviteCode)}` : "",
    ]));
  }
  if (msg.productMessage) {
    const p = msg.productMessage.product ?? {};
    const text = joinLines([
      `🛍️ Produto: ${clean(p.title)}`.trim(),
      clean(p.description),
      moneyText(p.salePriceAmount1000 ?? p.priceAmount1000, p.currencyCode),
      clean(msg.productMessage.body),
    ]);
    return p.productImage ? media("image", text, { mediaMessage: { imageMessage: p.productImage } }) : plain(text);
  }
  if (msg.orderMessage) {
    const o = msg.orderMessage;
    return plain(joinLines([
      `🛒 Pedido${o.orderTitle ? `: ${clean(o.orderTitle)}` : ""}`,
      o.itemCount ? `${o.itemCount} ${Number(o.itemCount) === 1 ? "item" : "itens"}` : "",
      moneyText(o.totalAmount1000, o.totalCurrencyCode),
      clean(o.message),
    ]));
  }
  if (msg.requestPaymentMessage || msg.sendPaymentMessage) {
    const p = msg.requestPaymentMessage;
    const note = p?.noteMessage?.extendedTextMessage?.text ?? p?.noteMessage?.conversation;
    return plain(joinLines([
      `💲 ${p ? "Pedido de pagamento" : "Pagamento enviado"}`,
      p ? moneyText(p.amount1000, p.currencyCodeIso4217) : "",
      clean(note),
    ]));
  }
  if (msg.requestPhoneNumberMessage) return plain("📱 Pedido para compartilhar o número de telefone");
  if (msg.callLogMesssage || msg.callLogMessage || msg.bcallMessage) return plain("📞 Chamada de voz ou vídeo");

  // Tipo que ainda não tratamos: o atendente precisa saber que chegou algo
  return {
    messageType: "text",
    text: fromMe ? UNSUPPORTED_TEXT_FROM_ME : UNSUPPORTED_TEXT,
    needsMediaFetch: false,
    unsupported: contentKeys(msg),
  };
}

/** Tipo do arquivo informado na própria mensagem (reserva quando a Evolution não manda). */
export function mediaMimeType(mediaMessage: Record<string, any> | undefined): string | undefined {
  for (const value of Object.values(mediaMessage ?? {})) {
    const mime = value?.mimetype ?? value?.message?.documentMessage?.mimetype;
    if (mime) return String(mime);
  }
  return undefined;
}

/** Nome do arquivo informado na própria mensagem. */
export function mediaFilename(mediaMessage: Record<string, any> | undefined): string | undefined {
  const doc = mediaMessage?.documentMessage ?? mediaMessage?.documentWithCaptionMessage?.message?.documentMessage;
  return doc?.fileName ? String(doc.fileName) : undefined;
}
