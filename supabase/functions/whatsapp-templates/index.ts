/**
 * whatsapp-templates — Modelos de mensagem do WhatsApp oficial (Meta)
 *
 * Usada pela tela de Campanhas. Fala com a Meta pelo token da conexão
 * oficial da empresa (channel_connections, provider "meta") e grava em
 * message_templates, que para o app é só leitura.
 *
 * Ações (POST, JSON):
 *   create  { action, name, category, body, footer?, buttons? }
 *           envia para a Meta (POST /{waba_id}/message_templates) e grava
 *           o modelo com o status que ela devolveu (quase sempre "pending")
 *   sync    { action }
 *           busca os modelos na Meta e atualiza status e motivo de recusa
 *           (o webhook do meta-webhook também atualiza, isto é a garantia)
 *   delete  { action, templateId }
 *           apaga na Meta e na Unxet; recusado se uma campanha agendada ou
 *           enviando usa o modelo. Só admin ou quem criou.
 */ import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthenticatedUser } from "../_shared/security.ts";
import { clinicHasFeature, clinicIsSuspended } from "../_shared/plan.ts";
import { TEMPLATE_LANGUAGE, buildTemplateComponents, describeMetaError, describeRejection, mapMetaTemplateStatus, normalizeTemplateInput, toMetaTemplateName, validateTemplateInput } from "../_shared/metaTemplates.ts";
// META_GRAPH_URL só no ambiente local (simulador da Meta); sem ela, a Graph API real
const GRAPH = (Deno.env.get("META_GRAPH_URL") || "https://graph.facebook.com/v21.0").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = 20000;
const SYNC_MAX_PAGES = 5;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (status, body)=>new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
// Erro mostrado na tela (o front lê `error`)
const fail = (status, error)=>json(status, {
    success: false,
    error
  });
async function graph(method, path, token, body) {
  try {
    const resp = await fetch(`${GRAPH}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...body ? {
          "Content-Type": "application/json"
        } : {}
      },
      ...body ? {
        body: JSON.stringify(body)
      } : {},
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const data = await resp.json().catch(()=>({}));
    return {
      ok: resp.ok,
      status: resp.status,
      body: data
    };
  } catch (err) {
    console.error("[WA_TEMPLATES_GRAPH_ERROR]", method, path.split("?")[0], err instanceof Error ? err.message : String(err));
    return {
      ok: false,
      status: 0,
      body: {}
    };
  }
}
/** Conexão oficial da empresa com o que é preciso para falar com a Meta. */ async function loadOfficialConnection(supabase, clinicId) {
  const { data, error } = await supabase.from("channel_connections").select("id, meta_waba_id, access_token, status").eq("clinic_id", clinicId).eq("provider", "meta").eq("channel", "whatsapp").is("archived_at", null).maybeSingle();
  if (error) {
    console.error("[WA_TEMPLATES_CONNECTION_ERROR]", error);
    return null;
  }
  const wabaId = String(data?.meta_waba_id ?? "").trim();
  const token = String(data?.access_token ?? "").trim();
  if (!data?.id || !wabaId || !token) return null;
  return {
    id: data.id,
    wabaId,
    token,
    status: data.status
  };
}
const randomSuffix = ()=>crypto.randomUUID().replace(/-/g, "").slice(0, 6);
async function createTemplate(supabase, ctx, body) {
  const input = normalizeTemplateInput({
    name: body?.name,
    category: body?.category,
    body: body?.body,
    footer: body?.footer,
    buttons: Array.isArray(body?.buttons) ? body.buttons : []
  });
  const invalid = validateTemplateInput(input);
  if (invalid) return fail(400, invalid);
  const metaName = toMetaTemplateName(input.name, randomSuffix());
  const created = await graph("POST", `${encodeURIComponent(ctx.connection.wabaId)}/message_templates`, ctx.connection.token, {
    name: metaName,
    language: TEMPLATE_LANGUAGE,
    category: input.category.toUpperCase(),
    components: buildTemplateComponents(input)
  });
  if (!created.ok || !created.body?.id) {
    console.error("[WA_TEMPLATES_CREATE_REJECTED]", created.status, JSON.stringify(created.body?.error ?? {}));
    if (created.status === 0) return fail(502, "A Meta não respondeu a tempo. Tente de novo em instantes.");
    return fail(400, describeMetaError(created.body, "A Meta recusou o modelo."));
  }
  const now = new Date().toISOString();
  const { data: row, error } = await supabase.from("message_templates").insert({
    clinic_id: ctx.clinicId,
    channel_connection_id: ctx.connection.id,
    created_by: ctx.userId,
    name: input.name,
    meta_template_name: metaName,
    meta_template_id: String(created.body.id),
    category: String(created.body.category ?? input.category).toLowerCase() === "utility" ? "utility" : "marketing",
    language_code: TEMPLATE_LANGUAGE,
    body: input.body,
    footer: input.footer,
    buttons: input.buttons ?? [],
    variables: /\{nome\}/i.test(input.body) ? [
      "nome"
    ] : [],
    status: mapMetaTemplateStatus(created.body.status) ?? "pending",
    last_meta_sync_at: now,
    updated_at: now
  }).select("id, status").maybeSingle();
  if (error || !row) {
    // Já está na Meta: sem a linha, o modelo some da tela. Registra para
    // recuperar pelo nome técnico.
    console.error("[WA_TEMPLATES_INSERT_ERROR]", metaName, created.body.id, error);
    return fail(500, "O modelo foi enviado para a Meta, mas não foi possível salvar na Unxet. Avise o suporte.");
  }
  return json(200, {
    success: true,
    template: row
  });
}
/** Busca todos os modelos do WABA (algumas páginas) e atualiza os da empresa. */ async function syncTemplates(supabase, ctx) {
  const { data: rows, error } = await supabase.from("message_templates").select("id, meta_template_id, meta_template_name, language_code, status, rejection_reason, category").eq("clinic_id", ctx.clinicId).not("meta_template_id", "is", null);
  if (error) {
    console.error("[WA_TEMPLATES_SYNC_LOAD_ERROR]", error);
    return fail(500, "Não foi possível atualizar os modelos.");
  }
  if (!rows || rows.length === 0) return json(200, {
    success: true,
    updated: 0
  });
  const remote = new Map();
  // Só dá para dizer que um modelo foi apagado na Meta se todas as páginas vieram
  let complete = false;
  let path =`${encodeURIComponent(ctx.connection.wabaId)}/message_templates?fields=id,name,language,status,category,rejected_reason&limit=100`;
  for(let page = 0; page < SYNC_MAX_PAGES && path; page++){
    const resp = await graph("GET", path, ctx.connection.token);
    if (!resp.ok) {
      console.error("[WA_TEMPLATES_SYNC_REJECTED]", resp.status, JSON.stringify(resp.body?.error ?? {}));
      if (resp.status === 0) return fail(502, "A Meta não respondeu a tempo. Tente de novo em instantes.");
      return fail(400, describeMetaError(resp.body, "Não foi possível consultar os modelos na Meta."));
    }
    for (const item of resp.body?.data ?? []){
      if (item?.id) remote.set(String(item.id), item);
    }
    const next = String(resp.body?.paging?.next ?? "");
    if (!next) {
      complete = true;
      break;
    }
    path = next.startsWith(`${GRAPH}/`) ? next.slice(GRAPH.length + 1) : "";
  }
  const now = new Date().toISOString();
  let updated = 0;
  for (const row of rows){
    const item = remote.get(String(row.meta_template_id));
    // Apagado direto no Gerenciador do WhatsApp: deixa de poder ser usado.
    // Lista incompleta (muitos modelos): quem não veio fica como está.
    if (!item && !complete) continue;
    const status = item ? mapMetaTemplateStatus(item.status) : "disabled";
    if (!status) continue;
    const rejection = status === "rejected" ? describeRejection(item?.rejected_reason) : null;
    const category = String(item?.category ?? row.category).toLowerCase() === "utility" ? "utility" : "marketing";
    const patch = {
      last_meta_sync_at: now
    };
    if (status !== row.status || rejection !== row.rejection_reason || category !== row.category) {
      patch.status = status;
      patch.rejection_reason = rejection;
      patch.category = category;
      patch.updated_at = now;
      updated++;
    }
    await supabase.from("message_templates").update(patch).eq("id", row.id);
  }
  return json(200, {
    success: true,
    updated
  });
}
async function deleteTemplate(supabase, ctx, body) {
  const templateId = String(body?.templateId ?? "").trim();
  if (!templateId) return fail(400, "Modelo não informado.");
  const { data: template } = await supabase.from("message_templates").select("id, clinic_id, created_by, meta_template_id, meta_template_name").eq("id", templateId).eq("clinic_id", ctx.clinicId).maybeSingle();
  if (!template) return fail(404, "Modelo não encontrado.");
  if (ctx.role !== "admin" && template.created_by !== ctx.userId) {
    return fail(403, "Só quem criou o modelo ou um administrador pode apagá-lo.");
  }
  const { count } = await supabase.from("scheduled_messages").select("id", {
    count: "exact",
    head: true
  }).eq("template_id", templateId).in("status", [
    "scheduled",
    "processing"
  ]);
  if ((count ?? 0) > 0) {
    return fail(409, "Uma campanha agendada ou em envio usa este modelo. Cancele ou edite a campanha antes.");
  }
  if (template.meta_template_name) {
    const params = new URLSearchParams({
      name: template.meta_template_name
    });
    if (template.meta_template_id) params.set("hsm_id", template.meta_template_id);
    const resp = await graph("DELETE", `${encodeURIComponent(ctx.connection.wabaId)}/message_templates?${params}`, ctx.connection.token);
    // Já não existe na Meta (apagado por lá): segue e apaga aqui
    const missing = resp.status === 404 || Number(resp.body?.error?.code) === 100;
    if (!resp.ok && !missing) {
      console.error("[WA_TEMPLATES_DELETE_REJECTED]", resp.status, JSON.stringify(resp.body?.error ?? {}));
      if (resp.status === 0) return fail(502, "A Meta não respondeu a tempo. Tente de novo em instantes.");
      return fail(400, describeMetaError(resp.body, "A Meta não deixou apagar o modelo."));
    }
  }
  const { error } = await supabase.from("message_templates").delete().eq("id", templateId);
  if (error) {
    console.error("[WA_TEMPLATES_DELETE_ERROR]", error);
    return fail(500, "O modelo foi apagado na Meta, mas não na Unxet. Tente de novo.");
  }
  return json(200, {
    success: true
  });
}
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  if (req.method !== "POST") return fail(405, "Method not allowed");
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) return fail(401, "Unauthorized");
    // Cada pessoa pertence a uma empresa (mesma regra do scheduled_message_save)
    const { data: membership } = await supabase.from("clinic_users").select("clinic_id, role").eq("user_id", authUser.id).limit(1).maybeSingle();
    if (!membership?.clinic_id) return fail(403, "Forbidden");
    const clinicId = membership.clinic_id;
    if (!await clinicHasFeature(supabase, clinicId, "scheduled_messages")) {
      return fail(403, "Campanhas não fazem parte do plano da empresa.");
    }
    const body = await req.json().catch(()=>({}));
    const action = String(body?.action ?? "");
    if (action === "create" && await clinicIsSuspended(supabase, clinicId)) {
      return fail(403, "O acesso da empresa está pausado.");
    }
    const connection = await loadOfficialConnection(supabase, clinicId);
    if (!connection) {
      return fail(400, "A empresa não tem o WhatsApp oficial conectado. Conecte em Integrações.");
    }
    const ctx = {
      clinicId,
      userId: authUser.id,
      role: membership.role,
      connection
    };
    if (action === "create") return await createTemplate(supabase, ctx, body);
    if (action === "sync") return await syncTemplates(supabase, ctx);
    if (action === "delete") return await deleteTemplate(supabase, ctx, body);
    return fail(400, "Ação inválida.");
  } catch (err) {
    console.error("[WA_TEMPLATES_FATAL]", err);
    return fail(500, "Erro inesperado. Tente de novo.");
  }
});
