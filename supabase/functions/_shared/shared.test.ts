// Testes dos helpers das edge functions (código Deno) rodando no Vitest:
// o objeto global Deno é simulado antes de importar os módulos.
import { beforeAll, describe, expect, it, vi } from "vitest";

const SUPABASE_URL = "https://abc.supabase.co";

let parseSurveyScore: (raw: unknown) => number | null;
let mediaPathFromUrl: (url: unknown) => string | null;

beforeAll(async () => {
  vi.stubGlobal("Deno", {
    env: { get: (name: string) => (name === "SUPABASE_URL" ? SUPABASE_URL : "") },
  });
  ({ parseSurveyScore } = await import("./satisfactionSurvey"));
  ({ mediaPathFromUrl } = await import("./media"));
});

describe("parseSurveyScore (pesquisa de satisfação)", () => {
  it.each([
    ["5", 5],
    ["nota 4", 4],
    ["4 estrelas", 4],
    ["cinco", 5],
    ["Três", 3],
    ["⭐⭐⭐", 3],
    ["3.", 3],
    ["  2 ! ", 2],
  ])("aceita %j como nota %i", (input, expected) => {
    expect(parseSurveyScore(input)).toBe(expected);
  });

  it.each(["10", "0", "6", "5 consultas", "1 minuto", "obrigado", "nota dez", "", null])(
    "rejeita %j",
    (input) => {
      expect(parseSurveyScore(input)).toBeNull();
    },
  );
});

describe("mediaPathFromUrl (bucket privado)", () => {
  const object = `${SUPABASE_URL}/storage/v1/object`;

  it("extrai o caminho de URLs do bucket", () => {
    expect(mediaPathFromUrl(`${object}/public/whatsapp-media/c/5511/inbound-audios/a.ogg`)).toBe(
      "c/5511/inbound-audios/a.ogg",
    );
    expect(mediaPathFromUrl(`${object}/public/whatsapp-media/c/outbound-images/x%20y.jpg`)).toBe(
      "c/outbound-images/x y.jpg",
    );
    expect(mediaPathFromUrl(`${object}/sign/whatsapp-media/c/a.ogg?token=t`)).toBe("c/a.ogg");
  });

  it.each([
    [`${object}/public/outro-bucket/a.jpg`, "outro bucket"],
    ["https://evil.com/storage/v1/object/public/whatsapp-media/a.jpg", "outro domínio"],
    ["https://abc.supabase.co.evil.com/storage/v1/object/public/whatsapp-media/a.jpg", "domínio parecido"],
    [`${object}/public/whatsapp-media/c/..%2F..%2Fsecret`, "caminho relativo"],
    [`${object}/public/whatsapp-media/`, "sem arquivo"],
    ["https://scontent.cdninstagram.com/v/a.mp4", "CDN externo"],
    [null, "vazio"],
  ])("rejeita %s (%s)", (url) => {
    expect(mediaPathFromUrl(url)).toBeNull();
  });
});
