import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY");
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const supabaseAdmin = ()=>createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const deepgramTranscribeFromUrl = async (url, language)=>{
  const endpoint = `https://api.deepgram.com/v1/listen` + `?model=nova-3` + `&smart_format=true` + `&punctuate=true` + `&language=${encodeURIComponent(language)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Token ${DEEPGRAM_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url
    })
  });
  if (!res.ok) {
    const t = await res.text().catch(()=>"");
    throw new Error(`deepgram_${res.status}: ${t}`);
  }
  const j = await res.json();
  const transcript = j?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  return transcript;
};
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  if (req.method !== "POST") return new Response("Method not allowed", {
    status: 405,
    headers: corsHeaders
  });
  const supabase = supabaseAdmin();
  try {
    const body = await req.json();
    const language = "language" in body && body.language ? body.language : "pt";
    let jobs = [];
    if ("mode" in body && body.mode === "drain") {
      const batchSize = body.batch_size ?? 5;
      const { data, error } = await supabase.rpc("claim_transcription_jobs", {
        batch_size: batchSize
      });
      if (error) throw new Error(`claim_failed: ${error.message}`);
      jobs = (data ?? []).map((r)=>({
          id: r.id,
          message_id: r.message_id,
          bucket: r.bucket,
          storage_path: r.storage_path,
          attempts: r.attempts
        }));
    } else {
      const jobId = body.job_id;
      const { data: claimed, error: claimErr } = await supabase.from("transcription_jobs").update({
        status: "PROCESSING",
        attempts: 0
      }).eq("id", jobId).eq("status", "PENDING").select("id,message_id,bucket,storage_path,attempts").maybeSingle();
      if (claimErr) throw new Error(`claim_one_failed: ${claimErr.message}`);
      if (!claimed) {
        return new Response(JSON.stringify({
          ok: true,
          skipped: true
        }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      jobs = [
        {
          id: claimed.id,
          message_id: claimed.message_id,
          bucket: claimed.bucket,
          storage_path: claimed.storage_path,
          attempts: claimed.attempts
        }
      ];
    }
    for (const job of jobs){
      try {
        const { data: signed, error: signErr } = await supabase.storage.from(job.bucket).createSignedUrl(job.storage_path, 60);
        if (signErr || !signed?.signedUrl) throw new Error(signErr?.message ?? "signed_url_failed");
        const transcript = await deepgramTranscribeFromUrl(signed.signedUrl, language);
        await supabase.from("messages").update({
          transcript_text: transcript || null,
          transcript_status: "DONE",
          transcript_error: null,
          transcript_language: language,
          transcript_provider: "deepgram"
        }).eq("id", job.message_id);
        await supabase.from("transcription_jobs").update({
          status: "DONE",
          error: null,
          updated_at: new Date().toISOString()
        }).eq("id", job.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase.from("messages").update({
          transcript_status: "FAILED",
          transcript_error: msg,
          transcript_provider: "deepgram",
          transcript_language: language
        }).eq("id", job.message_id);
        await supabase.from("transcription_jobs").update({
          status: "FAILED",
          error: msg,
          updated_at: new Date().toISOString()
        }).eq("id", job.id);
      }
    }
    return new Response(JSON.stringify({
      ok: true,
      processed: jobs.length
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({
      ok: false,
      error: msg
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
