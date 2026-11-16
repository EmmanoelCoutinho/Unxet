// deno-lint-ignore-file
// @ts-nocheck
/**
 * admin-delete-clinic — apaga uma empresa e tudo o que é dela, pelo painel da
 * Unxet.
 *
 * - Somente administradores da plataforma (platform_admins) podem chamar.
 * - O painel manda o nome da empresa digitado (confirm_name); se não bater
 *   com o nome atual, nada é apagado.
 * - Passos:
 *   1. desloga e apaga as instâncias da Evolution dos números QR Code (se a
 *      Evolution recusar, para aqui e nada é apagado: o número não pode
 *      ficar conectado sem empresa);
 *   2. platform_delete_clinic apaga a empresa no banco, com tudo em cascata,
 *      e devolve os arquivos e as contas a remover;
 *   3. apaga os arquivos do Storage (pasta da empresa em whatsapp-media);
 *   4. apaga do Auth as contas que não pertencem a outra empresa nem à
 *      equipe da Unxet.
 *   Falhas nos passos 3 e 4 não desfazem nada: voltam em "warnings".
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthenticatedUser } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const MEDIA_BUCKET = "whatsapp-media";
const STORAGE_BATCH = 500;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });

const log = (step: string, payload: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    fn: "admin-delete-clinic",
    step,
    ...payload
  }));

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const requester = await getAuthenticatedUser(req);
    if (!requester) return json(401, { error: "Unauthorized" });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: platformAdmin, error: platformErr } = await admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", requester.id)
      .maybeSingle();
    if (platformErr) {
      log("platform_admin_check_failed", { error: platformErr.message });
      return json(500, { error: platformErr.message });
    }
    if (!platformAdmin) {
      log("forbidden_not_platform_admin", { requesterId: requester.id });
      return json(403, { error: "Forbidden" });
    }

    const body = await req.json().catch(() => ({}));
    const clinicId = body?.clinic_id?.toString().trim() ?? "";
    const confirmName = body?.confirm_name?.toString().trim() ?? "";
    if (!isUuid(clinicId)) return json(400, { error: "Empresa inválida" });

    const { data: clinic, error: clinicErr } = await admin
      .from("clinics")
      .select("id, name")
      .eq("id", clinicId)
      .maybeSingle();
    if (clinicErr) return json(500, { error: clinicErr.message });
    if (!clinic) return json(404, { error: "Empresa não encontrada" });
    // NFC: o mesmo "á" pode chegar composto ou decomposto, conforme o teclado
    if (confirmName.normalize("NFC") !== (clinic.name ?? "").trim().normalize("NFC")) {
      return json(400, { error: "O nome digitado não confere com o da empresa." });
    }

    log("start", { clinicId, requesterId: requester.id });

    // 1. Instâncias da Evolution
    const evolutionApiUrl = (Deno.env.get("EVOLUTION_API_URL") ?? "").replace(/\/$/, "");
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY") ?? "";
    const { data: connections, error: connErr } = await admin
      .from("channel_connections")
      .select("id, session_name")
      .eq("clinic_id", clinicId)
      .eq("provider", "evolution")
      .is("archived_at", null);
    if (connErr) return json(500, { error: connErr.message });

    const sessions = (connections ?? [])
      .map((c) => String(c.session_name ?? "").trim())
      .filter(Boolean);
    if (sessions.length > 0 && (!evolutionApiUrl || !evolutionApiKey)) {
      return json(500, { error: "Evolution não configurada: não dá para remover os números." });
    }
    const headers = { "Content-Type": "application/json", apikey: evolutionApiKey };
    for (const sessionName of sessions) {
      // Logout antes do delete: algumas versões recusam apagar instância
      // conectada. Instância que já não existe (404) não impede.
      const logout = await fetch(`${evolutionApiUrl}/instance/logout/${sessionName}`, {
        method: "DELETE",
        headers
      }).catch((e) => ({ ok: false, status: 0, error: String(e) }));
      log("evolution_logout", { sessionName, status: logout.status });

      const del = await fetch(`${evolutionApiUrl}/instance/delete/${sessionName}`, {
        method: "DELETE",
        headers
      }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
      const delText = await del.text().catch(() => "");
      log("evolution_delete", { sessionName, status: del.status, body: delText });
      if (!del.ok && del.status !== 404) {
        return json(502, {
          error: `Não foi possível remover o número ${sessionName} na Evolution. Nada foi apagado; tente de novo.`
        });
      }
    }

    // 2. Banco
    const { data: result, error: deleteErr } = await admin.rpc("platform_delete_clinic", {
      p_clinic_id: clinicId
    });
    if (deleteErr) {
      log("delete_failed", { clinicId, error: deleteErr.message });
      return json(500, { error: deleteErr.message });
    }
    const files: string[] = result?.files ?? [];
    const userIds: string[] = result?.user_ids ?? [];
    const warnings: string[] = [];

    // 3. Storage
    let deletedFiles = 0;
    for (let i = 0; i < files.length; i += STORAGE_BATCH) {
      const chunk = files.slice(i, i + STORAGE_BATCH);
      const { error } = await admin.storage.from(MEDIA_BUCKET).remove(chunk);
      if (error) {
        log("storage_remove_failed", { clinicId, error: error.message });
        warnings.push(`Arquivos: ${error.message}`);
      } else {
        deletedFiles += chunk.length;
      }
    }

    // 4. Contas
    let deletedUsers = 0;
    for (const userId of userIds) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) {
        log("auth_delete_failed", { userId, error: error.message });
        warnings.push(`Conta ${userId}: ${error.message}`);
      } else {
        deletedUsers += 1;
      }
    }

    log("done", {
      clinicId,
      evolutionInstances: sessions.length,
      deletedFiles,
      deletedUsers,
      warnings: warnings.length
    });

    return json(200, {
      name: result?.name ?? clinic.name,
      evolution_instances: sessions.length,
      deleted_files: deletedFiles,
      deleted_users: deletedUsers,
      warnings
    });
  } catch (error) {
    log("unexpected_error", { error: error instanceof Error ? error.message : String(error) });
    return json(500, { error: error instanceof Error ? error.message : "Erro inesperado" });
  }
});
