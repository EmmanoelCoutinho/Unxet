import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("./supabaseClient", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

const BASE = "https://test-project.supabase.co/storage/v1/object/public/whatsapp-media";

// Módulo com cache interno: reimporta a cada teste
const loadModule = async () => {
  vi.resetModules();
  return import("./mediaUrls");
};

describe("mediaUrls", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("reconhece só URLs do bucket privado", async () => {
    const { isPrivateMediaUrl } = await loadModule();
    expect(isPrivateMediaUrl(`${BASE}/clinic/a.jpg`)).toBe(true);
    expect(isPrivateMediaUrl("https://scontent.cdninstagram.com/a.jpg")).toBe(false);
    expect(
      isPrivateMediaUrl("https://test-project.supabase.co/storage/v1/object/public/outro/a.jpg"),
    ).toBe(false);
    expect(isPrivateMediaUrl(undefined)).toBe(false);
  });

  it("devolve URLs externas sem chamar a função", async () => {
    const { resolveMediaUrl } = await loadModule();
    const url = "https://scontent.cdninstagram.com/a.jpg";
    await expect(resolveMediaUrl(url)).resolves.toBe(url);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("agrupa pedidos simultâneos em uma única chamada e usa o cache depois", async () => {
    const { resolveMediaUrl } = await loadModule();
    const a = `${BASE}/clinic/a.jpg`;
    const b = `${BASE}/clinic/b.ogg`;
    invoke.mockResolvedValue({
      data: { urls: { [a]: "signed-a", [b]: "signed-b" }, expiresIn: 3600 },
      error: null,
    });

    const [ra, rb] = await Promise.all([resolveMediaUrl(a), resolveMediaUrl(b)]);
    expect([ra, rb]).toEqual(["signed-a", "signed-b"]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("media-urls", { body: { urls: [a, b] } });

    await expect(resolveMediaUrl(a)).resolves.toBe("signed-a");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("não guarda acesso negado no cache (tenta de novo na próxima vez)", async () => {
    const { resolveMediaUrl } = await loadModule();
    const url = `${BASE}/clinic/novo.jpg`;
    invoke.mockResolvedValueOnce({ data: { urls: {} }, error: null });
    await expect(resolveMediaUrl(url)).resolves.toBeNull();

    invoke.mockResolvedValueOnce({ data: { urls: { [url]: "signed" } }, error: null });
    await expect(resolveMediaUrl(url)).resolves.toBe("signed");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("retorna null quando a função falha", async () => {
    const { resolveMediaUrl } = await loadModule();
    vi.spyOn(console, "error").mockImplementation(() => {});
    invoke.mockResolvedValue({ data: null, error: new Error("boom") });
    await expect(resolveMediaUrl(`${BASE}/clinic/x.jpg`)).resolves.toBeNull();
  });
});
