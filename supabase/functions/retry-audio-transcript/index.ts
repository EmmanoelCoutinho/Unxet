// deno-lint-ignore-file
// @ts-nocheck
/**
 * retry-audio-transcript — "Solicitar novo processamento" da transcrição de um
 * áudio (botão no chat). Cria um novo job e dispara a transcribe-audio.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthenticatedUser, getClinicMembership } from "../_shared/security.ts";
import { queueTranscription, runInBackground, storagePathFromPublicUrl } from "../_shared/transcription.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });

// Evita reprocessar em sequência (custo na Deepgram)
const RETRY_COOLDOWN_MS = 60_000;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return json(401, { error: "Unauthorized" });

    const { messageId, conversationId } = await req.json().catch(() => ({}));
    if (!messageId) return json(400, { error: "messageId is required" });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: message, error } = await admin
      .from("messages")
      .select(`
        id,
        type,
        media_url,
        conversation_id,
        conversations ( id, clinic_id, department_id, assigned_user_id )
      `)
      .eq("id", messageId)
      .maybeSingle();

    if (error || !message?.conversations) return json(404, { error: "Message not found" });
    if (conversationId && message.conversation_id !== conversationId) {
      return json(404, { error: "Message not found" });
    }
    if (message.type !== "audio") return json(400, { error: "Message is not audio" });

    // Mesma regra de acesso das conversas: admin, responsável ou, sem
    // responsável, membro do departamento
    const conversation = message.conversations;
    const membership = await getClinicMembership(admin, user.id, conversation.clinic_id);
    let allowed = !!membership && (
      membership.role === "admin" || conversation.assigned_user_id === user.id
    );
    if (!allowed && membership && !conversation.assigned_user_id) {
      if (membership.department_id === conversation.department_id) {
        allowed = true;
      } else {
        const { data: deptMember } = await admin
          .from("department_members")
          .select("department_id")
          .eq("department_id", conversation.department_id)
          .eq("clinic_user_id", user.id)
          .maybeSingle();
        allowed = !!deptMember;
      }
    }
    if (!allowed) return json(403, { error: "Not allowed" });

    const { data: lastJob } = await admin
      .from("transcription_jobs")
      .select("storage_path, status, created_at")
      .eq("message_id", message.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (
      lastJob &&
      ["PENDING", "PROCESSING"].includes(lastJob.status) &&
      Date.now() - new Date(lastJob.created_at).getTime() < RETRY_COOLDOWN_MS
    ) {
      return json(409, { error: "Transcrição já em andamento." });
    }

    const storagePath = lastJob?.storage_path ?? storagePathFromPublicUrl(message.media_url);
    if (!storagePath) {
      // Ex.: áudios do Instagram/Messenger ficam no CDN da Meta, não no Storage
      return json(422, { error: "Transcrição indisponível para este áudio." });
    }

    const queued = await queueTranscription(admin, { messageId: message.id, storagePath });
    if (!queued) return json(500, { error: "Não foi possível criar a transcrição." });

    runInBackground(queued.done);
    return json(200, { ok: true, jobId: queued.jobId });
  } catch (err) {
    console.error("[RETRY_TRANSCRIPT_UNEXPECTED]", err);
    return json(500, { error: "Internal error" });
  }
});
