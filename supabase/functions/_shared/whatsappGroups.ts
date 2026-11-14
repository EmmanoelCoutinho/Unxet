// deno-lint-ignore-file
// @ts-nocheck
// Grupos do WhatsApp (QR Code / Evolution).
//
// O grupo tem tabela própria (whatsapp_groups) e a conversa aponta para ele
// (conversations.group_id, sem contato). Quem escreve no grupo é um contato
// comum, ligado ao grupo por contact_groups quando o número é conhecido.
// Funções puras no topo (testadas no Vitest); as que usam banco/rede abaixo.

import { imageHash, isCurrentProfilePic, profilePicPath } from "./profilePicture.ts";

/** Telefone real: 10 a 13 dígitos (55 + DDD + número). LID tem 14-15. */
const PHONE_DIGITS = /^\d{10,13}$/;

/** Nome e foto do grupo são conferidos de novo depois deste intervalo. */
export const GROUP_INFO_REFRESH_MS = 6 * 60 * 60 * 1000;

const PROFILE_PIC_BUCKET = "whatsapp-media";

export const isGroupJid = (jid: unknown): jid is string =>
  typeof jid === "string" && jid.endsWith("@g.us");

/** Só os dígitos de um JID de telefone ("5511...@s.whatsapp.net"), ou null. */
const phoneFromJid = (jid: unknown): string | null => {
  if (typeof jid !== "string" || !jid || jid.includes("@lid") || jid.endsWith("@g.us")) return null;
  const digits = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
  return PHONE_DIGITS.test(digits) ? digits : null;
};

/**
 * Quem mandou a mensagem no grupo, a partir do key do webhook.
 * - phone: telefone real, quando o WhatsApp informa (participantAlt/participantPn
 *   ou participant no formato de telefone)
 * - lid: o LID, quando o participante vem escondido
 * - jid: o participante como veio (para responder citando)
 */
export function groupSender(key: any): { phone: string | null; lid: string | null; jid: string | null } {
  const participant = typeof key?.participant === "string" ? key.participant : "";
  const phone =
    phoneFromJid(key?.participantAlt) ??
    phoneFromJid(key?.participantPn) ??
    phoneFromJid(participant);
  return {
    phone,
    lid: participant.endsWith("@lid") ? participant : null,
    jid: participant || null,
  };
}

/** Destino na Evolution: o JID do grupo ou o número do contato. */
export function evolutionRecipient(conversation: {
  whatsapp_groups?: { jid?: string | null } | null;
  contacts?: { phone?: string | null } | null;
}): { number: string; remoteJid: string; isGroup: boolean } | null {
  const groupJid = conversation?.whatsapp_groups?.jid;
  if (isGroupJid(groupJid)) {
    return { number: groupJid, remoteJid: groupJid, isGroup: true };
  }
  const phone = String(conversation?.contacts?.phone ?? "").replace(/\D/g, "");
  if (!phone) return null;
  return { number: phone, remoteJid: `${phone}@s.whatsapp.net`, isGroup: false };
}

/** Pasta das fotos do grupo no Storage (separada das fotos de contatos). */
export const groupPicKey = (jid: string) => `group-${jid.split("@")[0].replace(/[^0-9-]/g, "")}`;

/** O nome e a foto precisam ser buscados na Evolution? */
export function groupInfoIsStale(
  group: { name?: string | null; info_synced_at?: string | null } | null,
  now = Date.now(),
) {
  if (!group) return true;
  if (!group.name || !group.info_synced_at) return true;
  const synced = new Date(group.info_synced_at).getTime();
  return !Number.isFinite(synced) || now - synced >= GROUP_INFO_REFRESH_MS;
}

/** Normaliza a resposta do /group/findGroupInfos (v2 devolve o grupo direto). */
export function parseGroupInfo(raw: any): { name: string | null; pictureUrl: string | null } {
  const source = Array.isArray(raw) ? raw[0] : raw?.group ?? raw;
  const name = typeof source?.subject === "string" && source.subject.trim() ? source.subject.trim() : null;
  const pictureUrl = typeof source?.pictureUrl === "string" && source.pictureUrl ? source.pictureUrl : null;
  return { name, pictureUrl };
}

// ---------------------------------------------------------------------------
// Banco / Evolution
// ---------------------------------------------------------------------------

async function fetchGroupInfo(apiUrl: string, apiKey: string, instanceName: string, jid: string) {
  try {
    const base = apiUrl.replace(/\/$/, "");
    const resp = await fetch(
      `${base}/group/findGroupInfos/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(jid)}`,
      { method: "GET", headers: { apikey: apiKey }, signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) {
      console.warn("[GROUP_INFO_FAILED]", jid, resp.status, await resp.text().catch(() => ""));
      return null;
    }
    return parseGroupInfo(await resp.json());
  } catch (err) {
    console.warn("[GROUP_INFO_ERROR]", jid, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Baixa a foto do grupo para o Storage (o link do WhatsApp expira). */
async function storeGroupPicture(supabase, clinicId: string, jid: string, pictureUrl: string, currentUrl: string | null) {
  try {
    const imgResp = await fetch(pictureUrl, { signal: AbortSignal.timeout(8000) });
    if (!imgResp.ok) return currentUrl;
    const data = await imgResp.arrayBuffer();
    const contentType = imgResp.headers.get("content-type") ?? "image/jpeg";
    const path = profilePicPath(clinicId, groupPicKey(jid), await imageHash(data), contentType);
    if (isCurrentProfilePic(currentUrl, path)) return currentUrl;
    const { error } = await supabase.storage.from(PROFILE_PIC_BUCKET).upload(path, data, { contentType, upsert: true });
    if (error) {
      console.warn("[GROUP_PICTURE_UPLOAD_FAILED]", jid, error.message);
      return currentUrl;
    }
    return supabase.storage.from(PROFILE_PIC_BUCKET).getPublicUrl(path).data?.publicUrl ?? currentUrl;
  } catch (err) {
    console.warn("[GROUP_PICTURE_ERROR]", jid, err instanceof Error ? err.message : String(err));
    return currentUrl;
  }
}

/**
 * Grupo da conexão (cria na primeira mensagem). Nome e foto vêm da Evolution
 * e são conferidos de tempos em tempos. Lança erro só se o banco falhar.
 */
export async function ensureWhatsappGroup(supabase, params: {
  clinicId: string;
  channelConnectionId: string;
  jid: string;
  evolution?: { apiUrl: string; apiKey: string; instanceName: string } | null;
}) {
  const { clinicId, channelConnectionId, jid, evolution } = params;
  const { data: existing, error: findErr } = await supabase
    .from("whatsapp_groups")
    .select("id, name, image_url, info_synced_at")
    .eq("channel_connection_id", channelConnectionId)
    .eq("jid", jid)
    .maybeSingle();
  if (findErr) throw new Error(`Group lookup error: ${findErr.message}`);

  if (existing && !groupInfoIsStale(existing)) return existing;

  const info = evolution ? await fetchGroupInfo(evolution.apiUrl, evolution.apiKey, evolution.instanceName, jid) : null;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (info) {
    patch.info_synced_at = now;
    if (info.name) patch.name = info.name;
    if (info.pictureUrl) {
      patch.image_url = await storeGroupPicture(supabase, clinicId, jid, info.pictureUrl, existing?.image_url ?? null);
    }
  }

  if (existing) {
    if (!info) return existing;
    const { data: updated, error } = await supabase
      .from("whatsapp_groups")
      .update(patch)
      .eq("id", existing.id)
      .select("id, name, image_url, info_synced_at")
      .maybeSingle();
    if (error) console.warn("[GROUP_UPDATE_FAILED]", jid, error.message);
    return updated ?? existing;
  }

  // Duas mensagens do mesmo grupo ao mesmo tempo: a segunda reaproveita
  const { data: created, error: insertErr } = await supabase
    .from("whatsapp_groups")
    .upsert(
      { clinic_id: clinicId, channel_connection_id: channelConnectionId, jid, ...patch },
      { onConflict: "channel_connection_id,jid" },
    )
    .select("id, name, image_url, info_synced_at")
    .maybeSingle();
  if (insertErr || !created) throw new Error(`Group insert error: ${insertErr?.message ?? "empty"}`);
  return created;
}

/** Liga o contato ao grupo (ou só atualiza a última vez que ele falou). */
export async function linkContactToGroup(supabase, params: {
  clinicId: string;
  contactId: string;
  groupId: string;
  at: string;
}) {
  const { error } = await supabase.from("contact_groups").upsert(
    {
      clinic_id: params.clinicId,
      contact_id: params.contactId,
      group_id: params.groupId,
      last_seen_at: params.at,
    },
    { onConflict: "contact_id,group_id" },
  );
  if (error) console.warn("[GROUP_LINK_FAILED]", params.groupId, params.contactId, error.message);
}
