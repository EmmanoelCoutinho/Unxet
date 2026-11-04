import { describe, expect, it, vi } from "vitest";
import {
  ensureInstanceSettings,
  isNonChatJid,
  normalizeSettings,
  settingsPatch,
} from "./evolutionSettings";

const current = {
  rejectCall: true,
  msgCall: "Não atendemos ligações",
  groupsIgnore: false,
  alwaysOnline: false,
  readMessages: false,
  readStatus: false,
  syncFullHistory: false,
};

describe("settingsPatch", () => {
  it("liga ignorar grupos e mantém o resto como estava", () => {
    expect(settingsPatch(current)).toEqual({ ...current, groupsIgnore: true });
  });

  it("desliga o histórico completo", () => {
    expect(settingsPatch({ ...current, groupsIgnore: true, syncFullHistory: true })).toEqual({
      ...current,
      groupsIgnore: true,
      syncFullHistory: false,
    });
  });

  it("não muda nada quando já está certo", () => {
    expect(settingsPatch({ ...current, groupsIgnore: true })).toBeNull();
  });

  it("aceita a resposta dentro de settings", () => {
    expect(settingsPatch({ settings: { ...current, groupsIgnore: true } })).toBeNull();
  });
});

describe("normalizeSettings", () => {
  it("preenche o que faltar e ignora campos desconhecidos", () => {
    expect(normalizeSettings({ groupsIgnore: true, instanceId: "x", rejectCall: "sim" })).toEqual({
      rejectCall: false,
      msgCall: "",
      groupsIgnore: true,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
    });
  });
});

const response = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status });

describe("ensureInstanceSettings", () => {
  it("só lê quando a instância já está certa", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { ...current, groupsIgnore: true }));
    await expect(
      ensureInstanceSettings("https://evo.test/", "key", "clinic_1", { fetchImpl }),
    ).resolves.toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://evo.test/settings/find/clinic_1");
  });

  it("grava as configurações completas quando precisa", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(200, current))
      .mockResolvedValueOnce(response(201));
    await expect(
      ensureInstanceSettings("https://evo.test", "key", "clinic_1", { fetchImpl }),
    ).resolves.toBe("updated");
    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe("https://evo.test/settings/set/clinic_1");
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe("key");
    expect(JSON.parse(init.body)).toEqual({ ...current, groupsIgnore: true });
  });

  it("não lança erro quando a Evolution falha", async () => {
    const down = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(ensureInstanceSettings("https://evo.test", "k", "s", { fetchImpl: down })).resolves.toBe(
      "failed",
    );
    const notFound = vi.fn().mockResolvedValue(response(404));
    await expect(
      ensureInstanceSettings("https://evo.test", "k", "s", { fetchImpl: notFound }),
    ).resolves.toBe("failed");
  });
});

describe("isNonChatJid", () => {
  it.each([
    ["status@broadcast", true],
    ["120363000000000000@newsletter", true],
    ["1234567890@broadcast", true],
    ["5591999999999@s.whatsapp.net", false],
    ["123456789012345@lid", false],
    ["", false],
    [undefined, false],
  ])("%j → %s", (jid, expected) => {
    expect(isNonChatJid(jid)).toBe(expected);
  });
});
