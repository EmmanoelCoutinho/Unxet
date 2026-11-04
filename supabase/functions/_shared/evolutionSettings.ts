// deno-lint-ignore-file
// @ts-nocheck
// Configurações das instâncias da Evolution que o Unxet garante
// (sem dependências, testáveis no Vitest).

/**
 * O que o Unxet precisa em toda instância:
 * - groupsIgnore: a Evolution nem gera webhook de grupo (o atendimento já
 *   ignorava grupos, mas cada mensagem chegava e era descartada no evolution-in)
 * - syncFullHistory: ao conectar, não manda o histórico antigo do celular
 */
export const REQUIRED_SETTINGS = {
  groupsIgnore: true,
  syncFullHistory: false,
};

// Campos aceitos pelo /settings/set da Evolution v2 (todos obrigatórios)
const DEFAULTS = {
  rejectCall: false,
  msgCall: "",
  groupsIgnore: false,
  alwaysOnline: false,
  readMessages: false,
  readStatus: false,
  syncFullHistory: false,
};

/** Normaliza a resposta do /settings/find (formatos v2 com e sem "settings"). */
export const normalizeSettings = (raw) => {
  const source = raw?.settings && typeof raw.settings === "object" ? raw.settings : raw ?? {};
  const result = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const value = source[key];
    if (key === "msgCall") {
      if (typeof value === "string") result.msgCall = value;
    } else if (typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
};

/**
 * Corpo do /settings/set quando algo precisa mudar, ou null quando a
 * instância já está certa. Mantém o resto como a empresa deixou.
 */
export const settingsPatch = (raw) => {
  const current = normalizeSettings(raw);
  const needsChange = Object.entries(REQUIRED_SETTINGS).some(
    ([key, value]) => current[key] !== value,
  );
  return needsChange ? { ...current, ...REQUIRED_SETTINGS } : null;
};

/**
 * Garante REQUIRED_SETTINGS na instância. Nunca lança erro: quem chama
 * segue o fluxo normal se a Evolution falhar.
 * Retorna "ok" (já estava certo), "updated" ou "failed".
 */
export const ensureInstanceSettings = async (
  apiUrl: string,
  apiKey: string,
  sessionName: string,
  { fetchImpl = fetch, timeoutMs = 8000 } = {},
) => {
  const base = apiUrl.replace(/\/$/, "");
  const name = encodeURIComponent(sessionName);
  try {
    const findResponse = await fetchImpl(`${base}/settings/find/${name}`, {
      method: "GET",
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!findResponse.ok) {
      await findResponse.body?.cancel?.();
      console.warn("[EVOLUTION_SETTINGS_FIND_FAILED]", { sessionName, status: findResponse.status });
      return "failed";
    }
    const patch = settingsPatch(await findResponse.json());
    if (!patch) return "ok";

    const setResponse = await fetchImpl(`${base}/settings/set/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!setResponse.ok) {
      console.warn("[EVOLUTION_SETTINGS_SET_FAILED]", {
        sessionName,
        status: setResponse.status,
        body: await setResponse.text().catch(() => ""),
      });
      return "failed";
    }
    await setResponse.body?.cancel?.();
    console.log("[EVOLUTION_SETTINGS_UPDATED]", { sessionName, ...REQUIRED_SETTINGS });
    return "updated";
  } catch (err) {
    console.warn("[EVOLUTION_SETTINGS_ERROR]", {
      sessionName,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
};

/**
 * Conversas que não são de um cliente: Status do WhatsApp (stories),
 * canais e listas de transmissão. A Evolution não tem opção para ignorá-las
 * na origem, então o filtro fica no evolution-in.
 */
export const isNonChatJid = (jid: unknown) => {
  if (typeof jid !== "string") return false;
  return jid === "status@broadcast" || jid.endsWith("@newsletter") || jid.endsWith("@broadcast");
};
