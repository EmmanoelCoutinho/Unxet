/**
 * start-conversation — O atendente puxa conversa com um cliente.
 *
 * Dois usos:
 *  - { conversationId }: botão "Iniciar conversa" numa conversa finalizada.
 *    Reabre a conversa com o atendente como responsável, para ele escrever.
 *  - { name, phone, contactId?, connectionId? }: Carteira de clientes.
 *    Acha ou cria o cliente pelo telefone. Com connectionId, também acha ou
 *    cria a conversa naquele número da empresa e a deixa em atendimento com
 *    o atendente. Sem connectionId, só salva o cliente.
 *
 * Retorna { ok, contactId, conversationId }.
 */ import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hasClinicPermission } from "../_shared/security.ts";
import { loadConnectionDepartment, pickDefaultDepartmentId } from "../_shared/connectionDepartment.ts";
import { BLOCKED_CONTACT_CODE, BLOCKED_CONTACT_ERROR, blockIdentifiers, isContactBlocked, isIdentifierBlocked } from "../_shared/contactBlock.ts";
import { brazilianPhoneVariants, isPlaceholderName, normalizeTypedPhone, parseWhatsappNumbersResponse } from "../_shared/startConversation.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const REQUEST_TIMEOUT_MS = 15000;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const json = (status, body)=>new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
class HttpError extends Error {
  status;
  code;
  constructor(status, message, code){
    super(message);
    this.status = status;
    this.code = code;
  }
}
/** Membro do setor da conversa (pela ficha do atendente ou por department_members). */ async function isDepartmentMember(admin, membership, departmentId) {
  if (!departmentId) return false;
  if (membership.department_id === departmentId) return true;
  const { data } = await admin.from("department_members").select("department_id").eq("department_id", departmentId).eq("clinic_user_id", membership.user_id).maybeSingle();
  return !!data;
}
async function isParticipant(admin, conversationId, userId) {
  const { data } = await admin.from("conversation_participants").select("user_id").eq("conversation_id", conversationId).eq("user_id", userId).maybeSingle();
  return !!data;
}
async function userName(admin, userId) {
  const { data } = await admin.from("clinic_users").select("name").eq("user_id", userId).maybeSingle();
  return data?.name ?? "outro atendente";
}
/**
 * Deixa a conversa em atendimento com o atendente.
 *  - finalizada: qualquer pessoa da empresa inicia (ninguém está atendendo)
 *  - na fila: mesma regra do "Aceitar"
 *  - em atendimento: só segue se já é dele (ou de ninguém)
 */ async function takeConversation(admin, conv, ctx) {
  const { user, membership, isAdmin, actorName } = ctx;
  const nowIso = new Date().toISOString();
  if (conv.status === "open") {
    if (conv.assigned_user_id === user.id) return conv.id;
    if (conv.assigned_user_id && await isParticipant(admin, conv.id, user.id)) return conv.id;
    if (conv.assigned_user_id) {
      throw new HttpError(409, `Esta conversa já está em atendimento com ${await userName(admin, conv.assigned_user_id)}.`, "conversation_taken");
    }
  }
  if (conv.status === "pending") {
    const allowed = isAdmin || conv.assigned_user_id === user.id || await isDepartmentMember(admin, membership, conv.department_id);
    if (!allowed) {
      throw new HttpError(409, "Este cliente está na fila de outro setor. Peça para alguém do setor aceitar ou transferir a conversa.", "conversation_other_department");
    }
    if (conv.assigned_user_id && conv.assigned_user_id !== user.id) {
      throw new HttpError(409, `Esta conversa está com ${await userName(admin, conv.assigned_user_id)}.`, "conversation_taken");
    }
  }
  const updates = {
    assigned_user_id: user.id,
    status: "open",
    in_bot_flow: false,
    closed_at: null,
    status_changed_at: nowIso,
    updated_at: nowIso
  };
  if (conv.status === "closed") updates.reopened_count = (conv.reopened_count ?? 0) + 1;
  // A condição vai no UPDATE: se alguém pegar a conversa ao mesmo tempo, só um vence
  let query = admin.from("conversations").update(updates).eq("id", conv.id).eq("status", conv.status);
  query = conv.assigned_user_id ? query.eq("assigned_user_id", conv.assigned_user_id) : query.is("assigned_user_id", null);
  const { data: updated, error } = await query.select("id").maybeSingle();
  if (error) throw new HttpError(500, "Não foi possível iniciar a conversa.");
  if (!updated) {
    throw new HttpError(409, "Outro atendente mexeu nesta conversa agora há pouco. Abra de novo e tente outra vez.", "conversation_changed");
  }
  if (conv.status !== "open") {
    await admin.from("conversation_events").insert({
      conversation_id: conv.id,
      event_type: "conversation_started",
      performed_by: user.id,
      metadata: {
        performed_by_name: actorName,
        previous_status: conv.status
      }
    });
  }
  return conv.id;
}
/** Confere o número na Evolution: devolve o número com WhatsApp (pode vir sem o 9). */ async function checkEvolutionNumber(connection, phone) {
  if (!connection.evolution_api_url || !connection.evolution_api_key || !connection.session_name) return phone;
  try {
    const resp = await fetch(`${String(connection.evolution_api_url).replace(/\/$/, "")}/chat/whatsappNumbers/${connection.session_name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: connection.evolution_api_key
      },
      body: JSON.stringify({
        numbers: [
          phone
        ]
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!resp.ok) {
      await resp.body?.cancel();
      return phone;
    }
    const result = parseWhatsappNumbersResponse(await resp.json().catch(()=>null));
    if (result === false) {
      throw new HttpError(422, "Este número não tem WhatsApp. Confira o DDD e o número.", "no_whatsapp");
    }
    return result ?? phone;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // Evolution fora do ar: segue com o número digitado
    console.error("[START_CONVERSATION_CHECK_NUMBER]", err instanceof Error ? err.message : String(err));
    return phone;
  }
}
async function findContactByPhone(admin, clinicId, phone) {
  const { data, error } = await admin.from("contacts").select("id, name, phone").eq("clinic_id", clinicId).in("phone", brazilianPhoneVariants(phone)).limit(1);
  if (error) throw new HttpError(500, "Não foi possível buscar o cliente.");
  return data?.[0] ?? null;
}
async function findOrCreateContact(admin, clinicId, name, phone) {
  const found = await findContactByPhone(admin, clinicId, phone);
  if (found) {
    // Cliente que chegou pelo WhatsApp sem nome de perfil ganha o nome digitado
    if (name && isPlaceholderName(found.name)) {
      await admin.from("contacts").update({
        name
      }).eq("id", found.id);
    }
    return {
      id: found.id,
      created: false
    };
  }
  const { data: created, error } = await admin.from("contacts").insert({
    clinic_id: clinicId,
    phone,
    name: name || phone,
    meta_contact_id: phone
  }).select("id").maybeSingle();
  // O cliente escreveu (ou outra pessoa o cadastrou) no mesmo instante
  if (error?.code === "23505") {
    const again = await findContactByPhone(admin, clinicId, phone);
    if (again) return {
      id: again.id,
      created: false
    };
  }
  if (error || !created) {
    console.error("[START_CONVERSATION_CONTACT_INSERT]", error);
    throw new HttpError(500, "Não foi possível salvar o cliente.");
  }
  return {
    id: created.id,
    created: true
  };
}
const CONVERSATION_FIELDS = "id, clinic_id, contact_id, department_id, status, assigned_user_id, reopened_count";
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, {
      error: "Missing Authorization"
    });
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData?.user) return json(401, {
      error: "Invalid auth"
    });
    const user = userData.user;
    const body = await req.json().catch(()=>({}));
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const loadContext = async (clinicId)=>{
      const { data: membership } = await admin.from("clinic_users").select("user_id, clinic_id, department_id, role, name, email").eq("user_id", user.id).eq("clinic_id", clinicId).maybeSingle();
      if (!membership) throw new HttpError(403, "Not allowed");
      const isAdmin = String(membership.role ?? "").toLowerCase() === "admin" || await hasClinicPermission(admin, user.id, clinicId, "conversations.all");
      const actorName = membership.name ?? user.user_metadata?.name ?? user.email ?? membership.email ?? "Atendente";
      return {
        user,
        membership,
        isAdmin,
        actorName
      };
    };
    // ── 1. Conversa finalizada: "Iniciar conversa" ─────────────────────────
    if (body?.conversationId) {
      const { data: conv } = await admin.from("conversations").select(CONVERSATION_FIELDS).eq("id", body.conversationId).maybeSingle();
      if (!conv) return json(404, {
        error: "Conversa não encontrada."
      });
      const ctx = await loadContext(conv.clinic_id);
      if (await isContactBlocked(admin, conv.contact_id)) return json(409, {
        error: BLOCKED_CONTACT_ERROR,
        code: BLOCKED_CONTACT_CODE
      });
      const conversationId = await takeConversation(admin, conv, ctx);
      return json(200, {
        ok: true,
        contactId: conv.contact_id,
        conversationId
      });
    }
    // ── 2. Carteira de clientes ────────────────────────────────────────────
    const clinicId = String(body?.clinicId ?? "");
    if (!clinicId) return json(400, {
      error: "clinicId is required"
    });
    const ctx = await loadContext(clinicId);
    const name = String(body?.name ?? "").trim().slice(0, 120);
    let contactId = body?.contactId ? String(body.contactId) : null;
    let phone = null;
    if (contactId) {
      const { data: contact } = await admin.from("contacts").select("id, phone").eq("id", contactId).eq("clinic_id", clinicId).maybeSingle();
      if (!contact) return json(404, {
        error: "Cliente não encontrado."
      });
      phone = normalizeTypedPhone(contact.phone);
    } else {
      phone = normalizeTypedPhone(body?.phone);
      if (!phone) return json(422, {
        error: "Número inválido. Use DDD + número, por exemplo (11) 98765-4321."
      });
    }
    const connectionId = body?.connectionId ? String(body.connectionId) : null;
    let connection = null;
    if (connectionId) {
      const { data } = await admin.from("channel_connections").select("id, provider, status, archived_at, session_name, evolution_api_url, evolution_api_key").eq("id", connectionId).eq("clinic_id", clinicId).eq("channel", "whatsapp").maybeSingle();
      if (!data || data.archived_at) return json(404, {
        error: "Número da empresa não encontrado."
      });
      if (data.status !== "connected") return json(409, {
        error: "Este número da empresa está desconectado. Reconecte em Integrações ou escolha outro.",
        code: "connection_offline"
      });
      connection = data;
      // QR Code: confere se o cliente tem WhatsApp e usa o número que o
      // WhatsApp reconhece (assim a resposta dele cai nesta mesma conversa)
      if (connection.provider === "evolution" && phone) {
        phone = await checkEvolutionNumber(connection, phone);
      }
    }
    // Contato bloqueado: a empresa também não inicia conversa com ele
    const blocked = contactId ? await isContactBlocked(admin, contactId) : await isIdentifierBlocked(admin, clinicId, blockIdentifiers(phone));
    if (blocked) return json(409, {
      error: BLOCKED_CONTACT_ERROR,
      code: BLOCKED_CONTACT_CODE
    });
    if (!contactId) {
      const contact = await findOrCreateContact(admin, clinicId, name, phone);
      contactId = contact.id;
    }
    if (!connection) {
      return json(200, {
        ok: true,
        contactId,
        conversationId: null
      });
    }
    // WhatsApp oficial: a conversa é do número (whatsapp_numbers), como no shared-in-config
    let whatsappNumberId = null;
    if (connection.provider === "meta") {
      const { data: number } = await admin.from("whatsapp_numbers").select("id").eq("channel_connection_id", connection.id).maybeSingle();
      whatsappNumberId = number?.id ?? null;
    }
    let findQuery = admin.from("conversations").select(CONVERSATION_FIELDS).eq("clinic_id", clinicId).eq("contact_id", contactId).eq("channel", "whatsapp").eq("channel_connection_id", connection.id);
    if (whatsappNumberId) findQuery = findQuery.eq("whatsapp_number_id", whatsappNumberId);
    const { data: found } = await findQuery.order("last_message_at", {
      ascending: false,
      nullsFirst: false
    }).limit(1);
    if (found?.[0]) {
      const conversationId = await takeConversation(admin, found[0], ctx);
      return json(200, {
        ok: true,
        contactId,
        conversationId
      });
    }
    const [{ data: department }, connectionDepartment] = await Promise.all([
      admin.from("departments").select("id").eq("clinic_id", clinicId).eq("is_default", true).eq("is_active", true).maybeSingle(),
      loadConnectionDepartment(admin, connection.id)
    ]);
    const departmentId = pickDefaultDepartmentId(connectionDepartment, clinicId, department?.id ?? null);
    if (!departmentId) return json(409, {
      error: "A empresa não tem um departamento padrão ativo."
    });
    const nowIso = new Date().toISOString();
    const { data: created, error: createErr } = await admin.from("conversations").insert({
      clinic_id: clinicId,
      contact_id: contactId,
      channel: "whatsapp",
      channel_connection_id: connection.id,
      ...whatsappNumberId ? {
        whatsapp_number_id: whatsappNumberId
      } : {},
      department_id: departmentId,
      status: "open",
      assigned_user_id: user.id,
      in_bot_flow: false,
      status_changed_at: nowIso,
      last_message_at: nowIso
    }).select("id").maybeSingle();
    if (createErr || !created) {
      console.error("[START_CONVERSATION_INSERT]", createErr);
      return json(500, {
        error: "Não foi possível criar a conversa."
      });
    }
    await admin.from("conversation_events").insert({
      conversation_id: created.id,
      event_type: "conversation_started",
      performed_by: user.id,
      metadata: {
        performed_by_name: ctx.actorName,
        previous_status: null
      }
    });
    return json(200, {
      ok: true,
      contactId,
      conversationId: created.id
    });
  } catch (e) {
    if (e instanceof HttpError) {
      return json(e.status, {
        error: e.message,
        code: e.code
      });
    }
    console.error("[START_CONVERSATION_ERROR]", e);
    return json(500, {
      error: e instanceof Error ? e.message : "Unknown error"
    });
  }
});
