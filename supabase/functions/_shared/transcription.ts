// deno-lint-ignore-file
// @ts-nocheck
// Transcrição de áudio: criação do job e disparo da edge function transcribe-audio.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_BOT_SECRET = Deno.env.get("INTERNAL_BOT_SECRET") ?? "";

export const TRANSCRIPTION_BUCKET = "whatsapp-media";
// Slug publicado da função (o nome exibido no painel é "transcribe-worker")
const TRANSCRIBE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/transcribe-audio`;

/** Extrai o caminho no Storage a partir da URL pública do bucket. */
export const storagePathFromPublicUrl = (url: unknown, bucket = TRANSCRIPTION_BUCKET) => {
  const value = typeof url === "string" ? url.trim() : "";
  if (!value) return null;
  const prefix = `${SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/`;
  if (!value.startsWith(prefix)) return null;
  const path = value.slice(prefix.length).split("?")[0];
  return path ? decodeURIComponent(path) : null;
};

/**
 * Dispara o processamento de um job. Não aguarda a transcrição: falhas ficam
 * registradas no job/mensagem pela própria transcribe-audio.
 */
export const triggerTranscriptionJob = (jobId: string, language = "pt") =>
  fetch(TRANSCRIBE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "x-internal-secret": INTERNAL_BOT_SECRET,
    },
    body: JSON.stringify({ job_id: jobId, language }),
  })
    .then(async (resp) => {
      if (!resp.ok) {
        console.error("[TRANSCRIPTION] transcribe-audio falhou:", resp.status, await resp.text());
      }
    })
    .catch((err) => {
      console.error("[TRANSCRIPTION] erro disparando transcribe-audio:", err);
    });

/**
 * Cria o job de transcrição de uma mensagem de áudio e dispara o processamento.
 * Sem caminho no Storage, marca a mensagem como FAILED (em vez de deixá-la
 * "carregando" para sempre).
 */
export const queueTranscription = async (
  admin,
  params: { messageId: string; storagePath: string | null; language?: string },
) => {
  if (!params.storagePath) {
    await admin
      .from("messages")
      .update({
        transcript_status: "FAILED",
        transcript_error: "audio_not_in_storage",
      })
      .eq("id", params.messageId);
    return null;
  }

  await admin
    .from("messages")
    .update({ transcript_status: "PENDING", transcript_error: null })
    .eq("id", params.messageId);

  const { data: job, error } = await admin
    .from("transcription_jobs")
    .insert({
      message_id: params.messageId,
      bucket: TRANSCRIPTION_BUCKET,
      storage_path: params.storagePath,
      status: "PENDING",
    })
    .select("id")
    .maybeSingle();

  if (error || !job?.id) {
    console.error("[TRANSCRIPTION] erro criando job:", error);
    await admin
      .from("messages")
      .update({ transcript_status: "FAILED", transcript_error: "job_create_failed" })
      .eq("id", params.messageId);
    return null;
  }

  return { jobId: job.id, done: triggerTranscriptionJob(job.id, params.language) };
};

/** Mantém a tarefa viva após a resposta da edge function (fire-and-forget seguro). */
export const runInBackground = (task: Promise<unknown> | undefined | null) => {
  if (!task) return;
  // @ts-ignore EdgeRuntime existe no runtime do Supabase
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(task);
  }
};
