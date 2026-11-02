import { describe, expect, it } from "vitest";
import { metaMessageKey } from "./metaMessageId";

// Ids reais da mesma mensagem: resposta do envio e eco do webhook (02/11/2026)
const SENT =
  "bmV3X2lnX2RtX2l0ZAW06MTpJR01lc3NhZA2VJRDoxNzg0MTQ3ODcxNjIxNjE2MDozNDAyODIzNjY4NDE3MTAzMDEyNDQyNjAwNTcwNjE5NDAyODQwMTI6MzMwODY3NjAyMjM1OTQ5NTA3MDY3NjEwMTgxNjIyODI0OTYZD";
const ECHO =
  "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDc4NzE2MjE2MTYwOjM0MDI4MjM2Njg0MTcxMDMwMTI0NDI2MDA1NzA2MTk0MDI4NDAxMjozMzA4Njc2MDIyMzU5NDk1MDcwNjc2MTAxODE2MjI4MjQ5NgZDZD";

describe("metaMessageKey", () => {
  it("dá a mesma chave para o envio e o eco da mesma mensagem do Instagram", () => {
    expect(metaMessageKey(SENT)).toBe(metaMessageKey(ECHO));
    expect(metaMessageKey(SENT)).toMatch(/^IGMessageID:17841478716216160:/);
  });

  it("mantém ids que não são do Instagram", () => {
    expect(metaMessageKey("m_abc123")).toBe("m_abc123");
    expect(metaMessageKey("client:1234")).toBe("client:1234");
  });

  it("devolve vazio sem id", () => {
    expect(metaMessageKey(null)).toBe("");
    expect(metaMessageKey("  ")).toBe("");
  });
});
