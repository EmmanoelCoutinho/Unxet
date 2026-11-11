import { describe, expect, it, vi } from "vitest";
import {
  blockIdentifiers,
  isContactBlocked,
  isIdentifierBlocked,
  registerBlockedInbound,
} from "./contactBlock";

const rpcClient = (result: { data?: unknown; error?: unknown }) => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null, ...result });
  return { rpc };
};

describe("blockIdentifiers", () => {
  it("remove vazios e repetidos", () => {
    expect(blockIdentifiers("5511987654321", " 5511987654321 ", "", null, undefined)).toEqual([
      "5511987654321",
    ]);
  });

  it("mantém a chave de outros canais", () => {
    expect(blockIdentifiers("instagram:123")).toEqual(["instagram:123"]);
  });
});

describe("registerBlockedInbound", () => {
  it("devolve true quando o banco diz que está bloqueado", async () => {
    const supabase = rpcClient({ data: true });
    expect(await registerBlockedInbound(supabase, "clinic", ["5511987654321"])).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("register_blocked_inbound", {
      p_clinic_id: "clinic",
      p_identifiers: ["5511987654321"],
    });
  });

  it("deixa a mensagem passar quando a consulta falha", async () => {
    const supabase = rpcClient({ error: { message: "boom" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await registerBlockedInbound(supabase, "clinic", ["5511987654321"])).toBe(false);
    spy.mockRestore();
  });

  it("não consulta sem empresa ou sem identificador", async () => {
    const supabase = rpcClient({ data: true });
    expect(await registerBlockedInbound(supabase, null, ["5511987654321"])).toBe(false);
    expect(await registerBlockedInbound(supabase, "clinic", [])).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("isIdentifierBlocked", () => {
  it("usa a função que não conta mensagem barrada", async () => {
    const supabase = rpcClient({ data: true });
    expect(await isIdentifierBlocked(supabase, "clinic", ["5511987654321"])).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("is_contact_identifier_blocked", {
      p_clinic_id: "clinic",
      p_identifiers: ["5511987654321"],
    });
  });
});

describe("isContactBlocked", () => {
  const contactClient = (row: unknown, error: unknown = null) => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row, error }) }),
      }),
    }),
  });

  it("lê blocked_at do contato", async () => {
    expect(await isContactBlocked(contactClient({ blocked_at: "2026-11-11T10:00:00Z" }), "c1")).toBe(true);
    expect(await isContactBlocked(contactClient({ blocked_at: null }), "c1")).toBe(false);
    expect(await isContactBlocked(contactClient(null), "c1")).toBe(false);
  });

  it("sem contato não bloqueia", async () => {
    expect(await isContactBlocked(contactClient({ blocked_at: "x" }), null)).toBe(false);
  });
});
