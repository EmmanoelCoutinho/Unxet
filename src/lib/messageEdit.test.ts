import { describe, expect, it } from "vitest";
import { canEditMessage, EDIT_WINDOW_MS } from "./messageEdit";
import { editBlockReason } from "../../supabase/functions/_shared/outboundEdit";

const now = Date.parse("2026-11-20T15:00:00Z");
const base = {
  id: "m1",
  direction: "outbound" as const,
  type: "text",
  deletedAt: undefined,
  mediaUrl: undefined,
  payload: { key: { id: "3EB0" }, message: { conversation: "*Ana:*\nOi" } },
  createdAt: new Date(now - 60_000).toISOString(),
  senderUserId: "u1",
};
const opts = { provider: "evolution", currentUserId: "u1", now };

describe("canEditMessage (app)", () => {
  it("texto próprio, pelo QR Code, há menos de 15 minutos", () => {
    expect(canEditMessage(base, opts)).toBe(true);
  });

  it.each([
    ["de outro atendente", { senderUserId: "u2" }, {}],
    ["do cliente", { direction: "inbound" as const }, {}],
    ["apagada", { deletedAt: "2026-11-20T14:59:30Z" }, {}],
    ["com mídia", { type: "image", mediaUrl: "https://x/y.jpg" }, {}],
    ["localização", { payload: { message: { locationMessage: { degreesLatitude: 1 } } } }, {}],
    ["contato", { payload: { message: { contactMessage: { displayName: "A" } } } }, {}],
    ["ainda enviando", { id: "local-1" }, {}],
    ["depois de 15 minutos", { createdAt: new Date(now - EDIT_WINDOW_MS - 1000).toISOString() }, {}],
    ["WhatsApp oficial", {}, { provider: "meta" }],
  ])("não edita mensagem %s", (_label, override, optsOverride) => {
    expect(canEditMessage({ ...base, ...override }, { ...opts, ...optsOverride })).toBe(false);
  });
});

describe("editBlockReason (edge function)", () => {
  const params = {
    direction: "outbound",
    type: "text",
    deletedAt: null,
    hasMedia: false,
    payload: base.payload,
    sentAt: base.createdAt,
    provider: "evolution",
    now,
  };

  it("mesmas regras do app", () => {
    expect(editBlockReason(params)).toBeNull();
    expect(editBlockReason({ ...params, provider: "meta" })).toMatch(/não permite editar/);
    expect(editBlockReason({ ...params, sentAt: new Date(now - EDIT_WINDOW_MS - 1).toISOString() })).toMatch(/15 minutos/);
    expect(editBlockReason({ ...params, payload: { message: { locationMessage: {} } } })).toMatch(/texto/);
    expect(editBlockReason({ ...params, direction: "inbound" })).toMatch(/enviadas pela empresa/);
  });
});
