// deno-lint-ignore-file
// @ts-nocheck
// Helpers de segurança compartilhados entre as edge functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const encoder = new TextEncoder();

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// Comparação em tempo constante (evita vazar segredos por timing)
export const timingSafeEqual = (a: string, b: string) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

const hmacSha256Hex = async (secret: string, body: Uint8Array) => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, body));
};

/**
 * Valida o header X-Hub-Signature-256 da Meta contra um ou mais app secrets
 * (há apps Meta distintos para WhatsApp e para Instagram/Messenger).
 */
export const verifyMetaSignature = async (
  rawBody: Uint8Array,
  signatureHeader: string | null,
  appSecrets: Array<string | null | undefined>,
) => {
  const header = (signatureHeader ?? "").trim().toLowerCase();
  if (!header.startsWith("sha256=")) return false;
  const expected = header.slice("sha256=".length);

  for (const secret of appSecrets) {
    if (!secret) continue;
    const actual = await hmacSha256Hex(secret, rawBody);
    if (timingSafeEqual(actual, expected)) return true;
  }
  return false;
};

/** Retorna o usuário autenticado pelo JWT do header Authorization, ou null. */
export const getAuthenticatedUser = async (req: Request) => {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
};

/** Retorna o vínculo do usuário com a clínica (ou null se não pertencer). */
export const getClinicMembership = async (
  admin,
  userId: string,
  clinicId: string,
) => {
  if (!userId || !clinicId) return null;
  const { data, error } = await admin
    .from("clinic_users")
    .select("user_id, clinic_id, role, department_id")
    .eq("user_id", userId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) {
    console.error("Erro ao checar clinic_users:", error);
    return null;
  }
  return data ?? null;
};
