


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."bot_action_type" AS ENUM (
    'go_to_node',
    'send_message',
    'transfer_to_department',
    'add_tag',
    'handoff_to_human',
    'end_flow'
);


ALTER TYPE "public"."bot_action_type" OWNER TO "postgres";


CREATE TYPE "public"."bot_event_type" AS ENUM (
    'session_started',
    'message_sent',
    'option_selected',
    'invalid_option',
    'transferred',
    'tag_added',
    'human_handoff',
    'session_completed',
    'session_cancelled'
);


ALTER TYPE "public"."bot_event_type" OWNER TO "postgres";


CREATE TYPE "public"."bot_node_type" AS ENUM (
    'menu',
    'message',
    'handoff',
    'end'
);


ALTER TYPE "public"."bot_node_type" OWNER TO "postgres";


CREATE TYPE "public"."bot_session_end_reason" AS ENUM (
    'handoff',
    'human_reply',
    'manual_stop',
    'timeout',
    'invalid_limit',
    'flow_end'
);


ALTER TYPE "public"."bot_session_end_reason" OWNER TO "postgres";


CREATE TYPE "public"."bot_session_status" AS ENUM (
    'active',
    'completed',
    'cancelled',
    'expired'
);


ALTER TYPE "public"."bot_session_status" OWNER TO "postgres";


CREATE TYPE "public"."bot_status" AS ENUM (
    'active',
    'inactive'
);


ALTER TYPE "public"."bot_status" OWNER TO "postgres";


CREATE TYPE "public"."bot_trigger_type" AS ENUM (
    'first_inbound'
);


ALTER TYPE "public"."bot_trigger_type" OWNER TO "postgres";


CREATE TYPE "public"."campaign_recipient_status" AS ENUM (
    'pending',
    'queued',
    'sent',
    'delivered',
    'read',
    'replied',
    'failed',
    'skipped'
);


ALTER TYPE "public"."campaign_recipient_status" OWNER TO "postgres";


CREATE TYPE "public"."campaign_status" AS ENUM (
    'draft',
    'scheduled',
    'sending',
    'sent',
    'partially_failed',
    'failed',
    'cancelled'
);


ALTER TYPE "public"."campaign_status" OWNER TO "postgres";


CREATE TYPE "public"."channel_type" AS ENUM (
    'whatsapp',
    'instagram',
    'messenger'
);


ALTER TYPE "public"."channel_type" OWNER TO "postgres";


CREATE TYPE "public"."conversation_status" AS ENUM (
    'open',
    'pending',
    'closed'
);


ALTER TYPE "public"."conversation_status" OWNER TO "postgres";


CREATE TYPE "public"."message_direction" AS ENUM (
    'inbound',
    'outbound'
);


ALTER TYPE "public"."message_direction" OWNER TO "postgres";


CREATE TYPE "public"."message_template_category" AS ENUM (
    'marketing',
    'utility',
    'authentication'
);


ALTER TYPE "public"."message_template_category" OWNER TO "postgres";


CREATE TYPE "public"."message_template_status" AS ENUM (
    'draft',
    'submitted',
    'pending',
    'approved',
    'rejected',
    'paused',
    'disabled',
    'archived'
);


ALTER TYPE "public"."message_template_status" OWNER TO "postgres";


CREATE TYPE "public"."message_type" AS ENUM (
    'text',
    'image',
    'audio',
    'video',
    'document',
    'sticker',
    'other',
    'interactive'
);


ALTER TYPE "public"."message_type" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."transcription_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "bucket" "text" DEFAULT 'whatsapp-media'::"text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."transcription_jobs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_transcription_jobs"("batch_size" integer DEFAULT 5) RETURNS SETOF "public"."transcription_jobs"
    LANGUAGE "plpgsql"
    AS $$
begin
  return query
  with picked as (
    select id
    from public.transcription_jobs
    where status = 'PENDING'
      and attempts < 5
    order by created_at asc
    limit batch_size
    for update skip locked
  )
  update public.transcription_jobs j
  set status = 'PROCESSING',
      attempts = j.attempts + 1,
      updated_at = now(),
      error = null
  where j.id in (select id from picked)
  returning j.*;
end;
$$;


ALTER FUNCTION "public"."claim_transcription_jobs"("batch_size" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."conversations_set_default_department"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.department_id IS NULL THEN
    SELECT d.id
      INTO NEW.department_id
    FROM public.departments d
    WHERE d.clinic_id = NEW.clinic_id
      AND d.is_default = true
    LIMIT 1;
  END IF;

  -- Se ainda assim ficar NULL, impede limbo
  IF NEW.department_id IS NULL THEN
    RAISE EXCEPTION 'No default department found for clinic_id=%', NEW.clinic_id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."conversations_set_default_department"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_clinic_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select cu.clinic_id
  from public.clinic_users cu
  where cu.user_id = auth.uid()
  limit 1
$$;


ALTER FUNCTION "public"."current_clinic_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_message"("queue_name" "text", "msg" "jsonb") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN pgmq.send(queue_name, msg);
END;
$$;


ALTER FUNCTION "public"."enqueue_message"("queue_name" "text", "msg" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_message_batch"("queue_name" "text", "msgs" "jsonb"[]) RETURNS bigint[]
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN pgmq.send_batch(queue_name, msgs);
END;
$$;


ALTER FUNCTION "public"."enqueue_message_batch"("queue_name" "text", "msgs" "jsonb"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unread_counts"("p_user_id" "uuid", "p_conversation_ids" "uuid"[]) RETURNS TABLE("conversation_id" "uuid", "unread_count" integer)
    LANGUAGE "sql" STABLE
    AS $$
  select
    c.id as conversation_id,
    count(m.id)::int as unread_count
  from public.conversations c
  left join public.conversation_reads cr
    on cr.conversation_id = c.id
   and cr.user_id = p_user_id
  left join public.messages m
    on m.conversation_id = c.id
   and m.direction = 'inbound'
   and m.created_at > coalesce(cr.last_read_at, 'epoch'::timestamptz)
  where c.id = any(p_conversation_ids)
  group by c.id;
$$;


ALTER FUNCTION "public"."get_unread_counts"("p_user_id" "uuid", "p_conversation_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_clinic_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.clinic_users cu
    where cu.user_id = auth.uid()
      and cu.role = 'admin'
  )
$$;


ALTER FUNCTION "public"."is_clinic_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_clinic_member"("p_clinic_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.clinic_users cu
    where cu.clinic_id = p_clinic_id
      and cu.user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_clinic_member"("p_clinic_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_admin"("org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from organization_members m
     where m.organization_id = org
       and m.user_id = auth.uid()
       and m.is_active = true
       and m.role in ('ADMIN','MANAGER')
  );
$$;


ALTER FUNCTION "public"."is_org_admin"("org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_member"("org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from organization_members m
     where m.organization_id = org
       and m.user_id = auth.uid()
       and m.is_active = true
  );
$$;


ALTER FUNCTION "public"."is_org_member"("org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."job_conversation_auto_close"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer := 0;
begin
  with eligible as (
    select
      c.id,
      c.clinic_id,
      s.auto_close_after_minutes
    from public.conversations c
    join public.conversation_automation_settings s
      on s.clinic_id = c.clinic_id
    where c.status in ('open', 'pending')
      and s.auto_close_enabled = true
      and c.last_inbound_at is not null
      and now() >= c.last_inbound_at
        + (s.auto_close_after_minutes * interval '1 minute')
  ),
  updated as (
    update public.conversations c
    set
      status = 'closed',
      closed_at = now(),
      auto_closed_at = now(),
      auto_closed_reason = 'window_expired',
      status_changed_at = now(),
      updated_at = now()
    from eligible e
    where c.id = e.id
      and c.status in ('open', 'pending')
    returning c.id, c.clinic_id
  ),
  inserted_events as (
    insert into public.conversation_events (
      conversation_id,
      event_type,
      performed_by,
      metadata,
      created_at
    )
    select
      u.id,
      'closed_automatically',
      null,
      jsonb_build_object(
        'reason', 'window_expired',
        'source', 'system',
        'automation', 'auto_close'
      ),
      now()
    from updated u
    returning conversation_id
  )
  select count(*)
  into v_count
  from updated;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."job_conversation_auto_close"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."job_conversation_return_to_pending"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer := 0;
begin
  with eligible as (
    select
      c.id,
      c.clinic_id,
      s.return_to_pending_after_minutes
    from public.conversations c
    join public.conversation_automation_settings s
      on s.clinic_id = c.clinic_id
    where c.status = 'open'
      and s.return_to_pending_enabled = true
      and c.last_inbound_at is not null
      and now() >= c.last_inbound_at
        + (s.return_to_pending_after_minutes * interval '1 minute')
  ),
  updated as (
    update public.conversations c
    set
      status = 'pending',
      status_changed_at = now(),
      pending_returned_at = now(),
      updated_at = now()
    from eligible e
    where c.id = e.id
      and c.status = 'open'
    returning c.id, c.clinic_id
  ),
  inserted_events as (
    insert into public.conversation_events (
      conversation_id,
      event_type,
      performed_by,
      metadata,
      created_at
    )
    select
      u.id,
      'returned_to_pending_automatically',
      null,
      jsonb_build_object(
        'reason', 'return_to_pending_timeout',
        'source', 'system',
        'automation', 'return_to_pending'
      ),
      now()
    from updated u
    returning conversation_id
  )
  select count(*)
  into v_count
  from updated;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."job_conversation_return_to_pending"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."job_conversation_sla_first_response"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
declare
  v_count integer := 0;
begin
  with eligible as (
    select
      c.id,
      c.clinic_id,
      s.sla_first_response_after_minutes
    from public.conversations c
    join public.conversation_automation_settings s
      on s.clinic_id = c.clinic_id
    where s.sla_first_response_enabled = true
      and c.first_unanswered_inbound_at is not null
      and c.sla_breached_at is null
      and now() >= c.first_unanswered_inbound_at
        + (s.sla_first_response_after_minutes * interval '1 minute')
  ),
  updated as (
    update public.conversations c
    set
      sla_breached_at = now(),
      updated_at = now()
    from eligible e
    where c.id = e.id
      and c.sla_breached_at is null
    returning c.id, c.clinic_id
  )
  insert into public.conversation_events (
    conversation_id,
    event_type,
    performed_by,
    metadata,
    created_at
  )
  select
    u.id,
    'sla_first_response_breached',
    null,
    jsonb_build_object(
      'reason', 'sla_first_response_timeout'
    ),
    now()
  from updated u;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."job_conversation_sla_first_response"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_conversations_with_unread"("p_user_id" "uuid", "p_department_id" "uuid", "p_mode" "text", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS TABLE("id" "uuid", "contact_id" "uuid", "channel" "public"."channel_type", "status" "public"."conversation_status", "assigned_user_id" "uuid", "last_message_at" timestamp with time zone, "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "clinic_id" "uuid", "department_id" "uuid", "whatsapp_number_id" "uuid", "unread_count" integer)
    LANGUAGE "sql" STABLE
    AS $$
  with base as (
    select c.*
    from public.conversations c
    where c.department_id = p_department_id
      and (
        (p_mode = 'open' and c.assigned_user_id = p_user_id)
        or
        (p_mode = 'pending')
      )
    order by c.last_message_at desc nulls last, c.updated_at desc
    limit p_limit offset p_offset
  )
  select
    b.id,
    b.contact_id,
    b.channel,
    b.status,
    b.assigned_user_id,
    b.last_message_at,
    b.created_at,
    b.updated_at,
    b.clinic_id,
    b.department_id,
    b.whatsapp_number_id,
    (
      select count(*)::int
      from public.messages m
      left join public.conversation_reads cr
        on cr.conversation_id = b.id
       and cr.user_id = p_user_id
      where m.conversation_id = b.id
        and m.direction = 'inbound'
        and m.created_at > coalesce(cr.last_read_at, 'epoch'::timestamptz)
    ) as unread_count
  from base b;
$$;


ALTER FUNCTION "public"."list_conversations_with_unread"("p_user_id" "uuid", "p_department_id" "uuid", "p_mode" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_conversations_with_unread"("p_user_id" "uuid", "p_clinic_id" "uuid", "p_department_ids" "uuid"[], "p_mode" "text", "p_channel" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 200) RETURNS TABLE("id" "uuid", "status" "public"."conversation_status", "channel" "public"."channel_type", "last_message_at" timestamp with time zone, "created_at" timestamp with time zone, "assigned_user_id" "uuid", "contact_id" "uuid", "contact" "jsonb", "tags" "jsonb", "last_message" "jsonb", "unread_count" integer)
    LANGUAGE "sql" STABLE
    AS $$
  with base as (
    select c.*
    from public.conversations c
    where c.clinic_id = p_clinic_id
      and c.department_id = any(p_department_ids)
      and c.status <> 'closed'
      and (p_channel is null or c.channel::text = p_channel)
      and (
        (p_mode = 'open' and c.assigned_user_id = p_user_id)
        or
        (p_mode = 'pending')
      )
    order by c.last_message_at desc nulls last, c.updated_at desc
    limit p_limit
  ),
  contacts_json as (
    select
      b.id as conversation_id,
      to_jsonb(ct.*) as contact
    from base b
    left join public.contacts ct on ct.id = b.contact_id
  ),
  tags_json as (
    select
      b.id as conversation_id,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', t.id,
            'name', t.name,
            'color', coalesce(t.color, '#0A84FF')
          )
        ) filter (where t.id is not null),
        '[]'::jsonb
      ) as tags
    from base b
    left join public.conversation_tags ct on ct.conversation_id = b.id
    left join public.tags t on t.id = ct.tag_id
    group by b.id
  ),
  last_msg as (
    select distinct on (m.conversation_id)
      m.conversation_id,
      jsonb_build_object(
        'id', m.id,
        'text', m.text,
        'sent_at', coalesce(m.sent_at, m.created_at),
        'direction', m.direction,
        'type', m.type,
        'payload', m.payload
      ) as last_message
    from public.messages m
    join base b on b.id = m.conversation_id
    order by m.conversation_id, coalesce(m.sent_at, m.created_at) desc
  )
  select
    b.id,
    b.status,
    b.channel,
    b.last_message_at,
    b.created_at,
    b.assigned_user_id,
    b.contact_id,
    cj.contact,
    tj.tags,
    lm.last_message,
    (
      select count(*)::int
      from public.messages m
      left join public.conversation_reads cr
        on cr.conversation_id = b.id
       and cr.user_id = p_user_id
      where m.conversation_id = b.id
        and m.direction = 'inbound'
        and m.created_at > coalesce(cr.last_read_at, 'epoch'::timestamptz)
    ) as unread_count
  from base b
  left join contacts_json cj on cj.conversation_id = b.id
  left join tags_json tj on tj.conversation_id = b.id
  left join last_msg lm on lm.conversation_id = b.id;
$$;


ALTER FUNCTION "public"."list_conversations_with_unread"("p_user_id" "uuid", "p_clinic_id" "uuid", "p_department_ids" "uuid"[], "p_mode" "text", "p_channel" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_conversation_read"("p_conversation_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id
  from public.conversations
  where id = p_conversation_id;

  insert into public.conversation_reads (conversation_id, user_id, clinic_id, last_read_at, updated_at)
  values (p_conversation_id, auth.uid(), v_clinic_id, now(), now())
  on conflict (conversation_id, user_id)
  do update set last_read_at = excluded.last_read_at,
                updated_at = now();
end;
$$;


ALTER FUNCTION "public"."mark_conversation_read"("p_conversation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_conversation_read"("p_conversation_id" "uuid", "p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id
  from public.conversations
  where id = p_conversation_id;

  insert into public.conversation_reads (conversation_id, user_id, clinic_id, last_read_at, updated_at)
  values (p_conversation_id, p_user_id, v_clinic_id, now(), now())
  on conflict (conversation_id, user_id)
  do update set last_read_at = excluded.last_read_at,
                updated_at = now();
end;
$$;


ALTER FUNCTION "public"."mark_conversation_read"("p_conversation_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."on_conversation_status_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.status = 'RESOLVED' and new.resolved_at is null then
    new.resolved_at := now();
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."on_conversation_status_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."on_message_after_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  update conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;

  if new.direction = 'OUTBOUND' then
    update conversations
       set first_response_at = coalesce(first_response_at, new.created_at)
     where id = new.conversation_id
       and first_response_at is null;
  end if;

  -- Notificação simples para INBOUND (org-wide, sem targeting de agente)
  if new.direction = 'INBOUND' then
    insert into notifications (organization_id, conversation_id, type, payload)
    values (new.organization_id, new.conversation_id, 'INBOUND_MESSAGE',
            jsonb_build_object('message_id', new.id, 'preview', left(coalesce(new.body,''), 120)));
  end if;

  return new;
end $$;


ALTER FUNCTION "public"."on_message_after_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_mass_messages_to_queue"("p_queue_name" "text", "p_msgs" "jsonb") RETURNS bigint[]
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    item jsonb;
    msg_id bigint;
    ids bigint[] := '{}';
BEGIN
    -- Varre a array JSONB enviada pelo frontend
    FOR item IN SELECT * FROM jsonb_array_elements(p_msgs) LOOP
        msg_id := pgmq.send(p_queue_name, item);
        ids := array_append(ids, msg_id);
    END LOOP;
    
    RETURN ids;
END;
$$;


ALTER FUNCTION "public"."send_mass_messages_to_queue"("p_queue_name" "text", "p_msgs" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_belongs_to_clinic"("target_clinic_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select exists (
    select 1
    from public.clinic_users cu
    where cu.clinic_id = target_clinic_id
      and cu.user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."user_belongs_to_clinic"("target_clinic_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_can_access_conversation"("target_conversation_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select exists (
    select 1
    from public.conversations c
    where c.id = target_conversation_id
      and c.clinic_id = public.current_clinic_id()
      and (
        exists (
          select 1
          from public.clinic_users cu
          where cu.user_id = auth.uid()
            and cu.clinic_id = c.clinic_id
            and cu.role = 'admin'
        )
        or c.assigned_user_id = auth.uid()
        or (
          c.assigned_user_id is null
          and exists (
            select 1
            from public.department_members dm
            where dm.department_id = c.department_id
              and dm.clinic_user_id = auth.uid()
          )
        )
      )
  );
$$;


ALTER FUNCTION "public"."user_can_access_conversation"("target_conversation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_can_manage_clinic"("target_clinic_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select exists (
    select 1
    from public.clinic_users cu
    where cu.clinic_id = target_clinic_id
      and cu.user_id = auth.uid()
      and cu.role = 'admin'
  );
$$;


ALTER FUNCTION "public"."user_can_manage_clinic"("target_clinic_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_bot_channel_binding_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_bot_clinic_id uuid;
  v_channel_clinic_id uuid;
begin
  select b.clinic_id
    into v_bot_clinic_id
  from public.bots b
  where b.id = new.bot_id;

  if v_bot_clinic_id is null then
    raise exception 'Bot % not found', new.bot_id;
  end if;

  select cc.clinic_id
    into v_channel_clinic_id
  from public.channel_connections cc
  where cc.id = new.channel_connection_id;

  if v_channel_clinic_id is null then
    raise exception 'Channel connection % not found', new.channel_connection_id;
  end if;

  if new.clinic_id <> v_bot_clinic_id then
    raise exception 'bot_channel_bindings.clinic_id must match bots.clinic_id';
  end if;

  if new.clinic_id <> v_channel_clinic_id then
    raise exception 'bot_channel_bindings.clinic_id must match channel_connections.clinic_id';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validate_bot_channel_binding_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_bot_node_clinic_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_bot_clinic_id uuid;
begin
  select b.clinic_id
    into v_bot_clinic_id
  from public.bots b
  where b.id = new.bot_id;

  if v_bot_clinic_id is null then
    raise exception 'Bot % not found', new.bot_id;
  end if;

  if new.clinic_id <> v_bot_clinic_id then
    raise exception 'bot_nodes.clinic_id must match bots.clinic_id';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validate_bot_node_clinic_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_bot_option_clinic_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_node_clinic_id uuid;
  v_next_node_clinic_id uuid;
  v_department_clinic_id uuid;
  v_tag_clinic_id uuid;
begin
  select bn.clinic_id
    into v_node_clinic_id
  from public.bot_nodes bn
  where bn.id = new.bot_node_id;

  if v_node_clinic_id is null then
    raise exception 'Bot node % not found', new.bot_node_id;
  end if;

  if new.clinic_id <> v_node_clinic_id then
    raise exception 'bot_options.clinic_id must match bot_nodes.clinic_id';
  end if;

  if new.next_node_id is not null then
    select bn.clinic_id
      into v_next_node_clinic_id
    from public.bot_nodes bn
    where bn.id = new.next_node_id;

    if v_next_node_clinic_id is null then
      raise exception 'Next node % not found', new.next_node_id;
    end if;

    if v_next_node_clinic_id <> new.clinic_id then
      raise exception 'bot_options.next_node_id must belong to the same clinic';
    end if;
  end if;

  if new.target_department_id is not null then
    select d.clinic_id
      into v_department_clinic_id
    from public.departments d
    where d.id = new.target_department_id;

    if v_department_clinic_id is null then
      raise exception 'Department % not found', new.target_department_id;
    end if;

    if v_department_clinic_id <> new.clinic_id then
      raise exception 'bot_options.target_department_id must belong to the same clinic';
    end if;
  end if;

  if new.tag_id is not null then
    select t.clinic_id
      into v_tag_clinic_id
    from public.tags t
    where t.id = new.tag_id;

    if v_tag_clinic_id is null then
      raise exception 'Tag % not found', new.tag_id;
    end if;

    if v_tag_clinic_id <> new.clinic_id then
      raise exception 'bot_options.tag_id must belong to the same clinic';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validate_bot_option_clinic_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_bot_option_structure_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_node_bot_id uuid;
  v_next_node_bot_id uuid;
begin
  select bn.bot_id
    into v_node_bot_id
  from public.bot_nodes bn
  where bn.id = new.bot_node_id;

  if v_node_bot_id is null then
    raise exception 'Bot node % not found', new.bot_node_id;
  end if;

  if new.next_node_id is not null then
    select bn.bot_id
      into v_next_node_bot_id
    from public.bot_nodes bn
    where bn.id = new.next_node_id;

    if v_next_node_bot_id is null then
      raise exception 'Next node % not found', new.next_node_id;
    end if;

    if v_next_node_bot_id <> v_node_bot_id then
      raise exception 'bot_options.next_node_id must belong to the same bot as bot_options.bot_node_id';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validate_bot_option_structure_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_conversation_bot_event_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_session_clinic_id uuid;
  v_session_conversation_id uuid;
  v_session_bot_id uuid;
  v_conversation_clinic_id uuid;
  v_bot_clinic_id uuid;
  v_node_clinic_id uuid;
  v_option_clinic_id uuid;
begin
  select s.clinic_id, s.conversation_id, s.bot_id
    into v_session_clinic_id, v_session_conversation_id, v_session_bot_id
  from public.conversation_bot_sessions s
  where s.id = new.conversation_bot_session_id;

  if v_session_clinic_id is null then
    raise exception 'Conversation bot session % not found', new.conversation_bot_session_id;
  end if;

  select c.clinic_id
    into v_conversation_clinic_id
  from public.conversations c
  where c.id = new.conversation_id;

  if v_conversation_clinic_id is null then
    raise exception 'Conversation % not found', new.conversation_id;
  end if;

  select b.clinic_id
    into v_bot_clinic_id
  from public.bots b
  where b.id = new.bot_id;

  if v_bot_clinic_id is null then
    raise exception 'Bot % not found', new.bot_id;
  end if;

  if new.node_id is not null then
    select bn.clinic_id
      into v_node_clinic_id
    from public.bot_nodes bn
    where bn.id = new.node_id;

    if v_node_clinic_id is null then
      raise exception 'Node % not found', new.node_id;
    end if;

    if v_node_clinic_id <> new.clinic_id then
      raise exception 'conversation_bot_events.node_id must belong to the same clinic';
    end if;
  end if;

  if new.option_id is not null then
    select bo.clinic_id
      into v_option_clinic_id
    from public.bot_options bo
    where bo.id = new.option_id;

    if v_option_clinic_id is null then
      raise exception 'Option % not found', new.option_id;
    end if;

    if v_option_clinic_id <> new.clinic_id then
      raise exception 'conversation_bot_events.option_id must belong to the same clinic';
    end if;
  end if;

  if new.clinic_id <> v_session_clinic_id then
    raise exception 'conversation_bot_events.clinic_id must match session clinic_id';
  end if;

  if new.conversation_id <> v_session_conversation_id then
    raise exception 'conversation_bot_events.conversation_id must match session conversation_id';
  end if;

  if new.bot_id <> v_session_bot_id then
    raise exception 'conversation_bot_events.bot_id must match session bot_id';
  end if;

  if new.clinic_id <> v_conversation_clinic_id then
    raise exception 'conversation_bot_events.clinic_id must match conversations.clinic_id';
  end if;

  if new.clinic_id <> v_bot_clinic_id then
    raise exception 'conversation_bot_events.clinic_id must match bots.clinic_id';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validate_conversation_bot_event_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_conversation_bot_event_structure_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_session_bot_id uuid;
  v_node_bot_id uuid;
  v_option_node_id uuid;
  v_option_bot_id uuid;
begin
  select s.bot_id
    into v_session_bot_id
  from public.conversation_bot_sessions s
  where s.id = new.conversation_bot_session_id;

  if v_session_bot_id is null then
    raise exception 'Conversation bot session % not found', new.conversation_bot_session_id;
  end if;

  if new.bot_id <> v_session_bot_id then
    raise exception 'conversation_bot_events.bot_id must match session bot_id';
  end if;

  if new.node_id is not null then
    select bn.bot_id
      into v_node_bot_id
    from public.bot_nodes bn
    where bn.id = new.node_id;

    if v_node_bot_id is null then
      raise exception 'Node % not found', new.node_id;
    end if;

    if v_node_bot_id <> new.bot_id then
      raise exception 'conversation_bot_events.node_id must belong to the same bot as conversation_bot_events.bot_id';
    end if;
  end if;

  if new.option_id is not null then
    select bo.bot_node_id, bn.bot_id
      into v_option_node_id, v_option_bot_id
    from public.bot_options bo
    join public.bot_nodes bn
      on bn.id = bo.bot_node_id
    where bo.id = new.option_id;

    if v_option_bot_id is null then
      raise exception 'Option % not found', new.option_id;
    end if;

    if v_option_bot_id <> new.bot_id then
      raise exception 'conversation_bot_events.option_id must belong to the same bot as conversation_bot_events.bot_id';
    end if;

    if new.node_id is not null and v_option_node_id <> new.node_id then
      raise exception 'conversation_bot_events.option_id must belong to conversation_bot_events.node_id';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validate_conversation_bot_event_structure_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_conversation_bot_session_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_bot_clinic_id uuid;
  v_conversation_clinic_id uuid;
  v_channel_clinic_id uuid;
  v_node_clinic_id uuid;
begin
  select b.clinic_id
    into v_bot_clinic_id
  from public.bots b
  where b.id = new.bot_id;

  if v_bot_clinic_id is null then
    raise exception 'Bot % not found', new.bot_id;
  end if;

  select c.clinic_id
    into v_conversation_clinic_id
  from public.conversations c
  where c.id = new.conversation_id;

  if v_conversation_clinic_id is null then
    raise exception 'Conversation % not found', new.conversation_id;
  end if;

  select cc.clinic_id
    into v_channel_clinic_id
  from public.channel_connections cc
  where cc.id = new.channel_connection_id;

  if v_channel_clinic_id is null then
    raise exception 'Channel connection % not found', new.channel_connection_id;
  end if;

  if new.current_node_id is not null then
    select bn.clinic_id
      into v_node_clinic_id
    from public.bot_nodes bn
    where bn.id = new.current_node_id;

    if v_node_clinic_id is null then
      raise exception 'Current node % not found', new.current_node_id;
    end if;

    if v_node_clinic_id <> new.clinic_id then
      raise exception 'conversation_bot_sessions.current_node_id must belong to the same clinic';
    end if;
  end if;

  if new.clinic_id <> v_bot_clinic_id then
    raise exception 'conversation_bot_sessions.clinic_id must match bots.clinic_id';
  end if;

  if new.clinic_id <> v_conversation_clinic_id then
    raise exception 'conversation_bot_sessions.clinic_id must match conversations.clinic_id';
  end if;

  if new.clinic_id <> v_channel_clinic_id then
    raise exception 'conversation_bot_sessions.clinic_id must match channel_connections.clinic_id';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validate_conversation_bot_session_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_conversation_bot_session_structure_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_node_bot_id uuid;
begin
  if new.current_node_id is not null then
    select bn.bot_id
      into v_node_bot_id
    from public.bot_nodes bn
    where bn.id = new.current_node_id;

    if v_node_bot_id is null then
      raise exception 'Current node % not found', new.current_node_id;
    end if;

    if v_node_bot_id <> new.bot_id then
      raise exception 'conversation_bot_sessions.current_node_id must belong to the same bot as conversation_bot_sessions.bot_id';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validate_conversation_bot_session_structure_integrity"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bot_channel_bindings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clinic_id" "uuid" NOT NULL,
    "bot_id" "uuid" NOT NULL,
    "channel_connection_id" "uuid" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "trigger_type" "public"."bot_trigger_type" DEFAULT 'first_inbound'::"public"."bot_trigger_type" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bot_channel_bindings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bot_nodes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bot_id" "uuid" NOT NULL,
    "clinic_id" "uuid" NOT NULL,
    "node_key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "node_type" "public"."bot_node_type" DEFAULT 'menu'::"public"."bot_node_type" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bot_nodes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bot_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bot_node_id" "uuid" NOT NULL,
    "clinic_id" "uuid" NOT NULL,
    "option_value" "text" NOT NULL,
    "label" "text" NOT NULL,
    "action_type" "public"."bot_action_type" NOT NULL,
    "next_node_id" "uuid",
    "target_department_id" "uuid",
    "tag_id" "uuid",
    "message_to_send" "text",
    "end_session" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bot_options" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clinic_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "status" "public"."bot_status" DEFAULT 'inactive'::"public"."bot_status" NOT NULL,
    "type" "text" DEFAULT 'welcome_menu'::"text" NOT NULL,
    "published" boolean DEFAULT false NOT NULL,
    "start_message" "text" NOT NULL,
    "invalid_option_message" "text" DEFAULT 'Não entendi. Digite uma opção válida.'::"text" NOT NULL,
    "timeout_message" "text",
    "human_handoff_enabled" boolean DEFAULT true NOT NULL,
    "max_invalid_attempts" integer DEFAULT 3 NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaign_recipients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clinic_id" "uuid" NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "conversation_id" "uuid",
    "status" "public"."campaign_recipient_status" DEFAULT 'pending'::"public"."campaign_recipient_status" NOT NULL,
    "meta_message_id" "text",
    "phone" "text",
    "variables" "jsonb" DEFAULT '{}'::"jsonb",
    "error_message" "text",
    "queued_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "read_at" timestamp with time zone,
    "replied_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."campaign_recipients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clinic_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "template_id" "uuid" NOT NULL,
    "whatsapp_number_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "status" "public"."campaign_status" DEFAULT 'draft'::"public"."campaign_status" NOT NULL,
    "audience_type" "text" NOT NULL,
    "audience_filters" "jsonb" DEFAULT '{}'::"jsonb",
    "scheduled_at" timestamp with time zone,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "total_contacts" integer DEFAULT 0,
    "total_sent" integer DEFAULT 0,
    "total_delivered" integer DEFAULT 0,
    "total_read" integer DEFAULT 0,
    "total_replied" integer DEFAULT 0,
    "total_failed" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."channel_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clinic_id" "uuid" NOT NULL,
    "provider" "text" DEFAULT 'meta'::"text" NOT NULL,
    "channel" "text" NOT NULL,
    "meta_phone_number_id" "text",
    "meta_waba_id" "text",
    "meta_page_id" "text",
    "meta_ig_user_id" "text",
    "access_token" "text",
    "token_expires_at" timestamp with time zone,
    "status" "text" DEFAULT 'connected'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "session_name" "text",
    "evolution_api_url" "text",
    "evolution_api_key" "text",
    "qr_code" "text",
    "connected_phone" "text",
    "connected_name" "text",
    "last_connection_at" timestamp with time zone,
    "last_disconnection_at" timestamp with time zone,
    CONSTRAINT "channel_connections_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'instagram'::"text", 'messenger'::"text"]))),
    CONSTRAINT "channel_connections_provider_check" CHECK (("provider" = ANY (ARRAY['meta'::"text", 'evolution'::"text"])))
);


ALTER TABLE "public"."channel_connections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clinic_users" (
    "clinic_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'agent'::"text" NOT NULL,
    "name" "text",
    "department_id" "uuid",
    "email" "text",
    "invited_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    CONSTRAINT "clinic_users_role_check" CHECK (("role" = ANY (ARRAY['agent'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."clinic_users" OWNER TO "postgres";


COMMENT ON COLUMN "public"."clinic_users"."name" IS 'user name';



CREATE TABLE IF NOT EXISTS "public"."clinics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."clinics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "meta_contact_id" "text",
    "name" "text",
    "phone" "text",
    "first_seen_at" timestamp with time zone DEFAULT "now"(),
    "last_seen_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "clinic_id" "uuid",
    "image_url" "text"
);


ALTER TABLE "public"."contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_automation_settings" (
    "clinic_id" "uuid" NOT NULL,
    "return_to_pending_enabled" boolean DEFAULT false NOT NULL,
    "return_to_pending_after_minutes" integer,
    "auto_close_enabled" boolean DEFAULT false NOT NULL,
    "auto_close_after_minutes" integer,
    "reopen_on_inbound_enabled" boolean DEFAULT true NOT NULL,
    "sla_first_response_enabled" boolean DEFAULT false NOT NULL,
    "sla_first_response_after_minutes" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_auto_close_after_minutes" CHECK ((("auto_close_enabled" = false) OR ("auto_close_after_minutes" IS NOT NULL))),
    CONSTRAINT "chk_return_to_pending_after_minutes" CHECK ((("return_to_pending_enabled" = false) OR ("return_to_pending_after_minutes" IS NOT NULL))),
    CONSTRAINT "chk_sla_first_response_after_minutes" CHECK ((("sla_first_response_enabled" = false) OR ("sla_first_response_after_minutes" IS NOT NULL)))
);


ALTER TABLE "public"."conversation_automation_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_bot_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clinic_id" "uuid" NOT NULL,
    "conversation_bot_session_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "bot_id" "uuid" NOT NULL,
    "node_id" "uuid",
    "option_id" "uuid",
    "event_type" "public"."bot_event_type" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."conversation_bot_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_bot_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clinic_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "bot_id" "uuid" NOT NULL,
    "channel_connection_id" "uuid" NOT NULL,
    "current_node_id" "uuid",
    "status" "public"."bot_session_status" DEFAULT 'active'::"public"."bot_session_status" NOT NULL,
    "invalid_attempts_count" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_interaction_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "ended_reason" "public"."bot_session_end_reason",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."conversation_bot_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "performed_by" "uuid",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."conversation_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_reads" (
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "clinic_id" "uuid" NOT NULL,
    "last_read_message_id" "uuid",
    "last_read_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."conversation_reads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_tags" (
    "conversation_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL
);


ALTER TABLE "public"."conversation_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "meta_conversation_id" "text",
    "contact_id" "uuid",
    "channel" "public"."channel_type" DEFAULT 'whatsapp'::"public"."channel_type" NOT NULL,
    "status" "public"."conversation_status" DEFAULT 'open'::"public"."conversation_status" NOT NULL,
    "assigned_user_id" "uuid",
    "last_message_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "clinic_id" "uuid",
    "department_id" "uuid" NOT NULL,
    "whatsapp_number_id" "uuid",
    "source_entry_point" "text",
    "source_campaign" "text",
    "source_utm" "jsonb",
    "first_inbound_at" timestamp with time zone,
    "first_outbound_at" timestamp with time zone,
    "closed_at" timestamp with time zone,
    "reopened_count" integer DEFAULT 0 NOT NULL,
    "last_inbound_at" timestamp with time zone,
    "last_outbound_at" timestamp with time zone,
    "first_unanswered_inbound_at" timestamp with time zone,
    "status_changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "auto_closed_at" timestamp with time zone,
    "auto_closed_reason" "text",
    "sla_breached_at" timestamp with time zone,
    "pending_returned_at" timestamp with time zone,
    "channel_connection_id" "uuid"
);

ALTER TABLE ONLY "public"."conversations" REPLICA IDENTITY FULL;


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."department_members" (
    "department_id" "uuid" NOT NULL,
    "clinic_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."department_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."departments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clinic_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "is_default" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."departments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."edge_rate_limits" (
    "key" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "conversation_id" "uuid",
    "bucket_start" timestamp with time zone NOT NULL,
    "count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."edge_rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mass_campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "message" "text" NOT NULL,
    "target_type" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "total_targets" integer DEFAULT 0
);


ALTER TABLE "public"."mass_campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mass_messages_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "contact_id" "uuid" NOT NULL,
    "phone_text" "text" NOT NULL,
    "message_content" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "error_message" "text",
    "sent_at" timestamp with time zone
);


ALTER TABLE "public"."mass_messages_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."message_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clinic_id" "uuid" NOT NULL,
    "whatsapp_number_id" "uuid",
    "created_by" "uuid",
    "name" "text" NOT NULL,
    "meta_template_name" "text",
    "category" "public"."message_template_category" NOT NULL,
    "language_code" "text" DEFAULT 'pt_BR'::"text" NOT NULL,
    "body" "text" NOT NULL,
    "variables" "jsonb" DEFAULT '[]'::"jsonb",
    "footer" "text",
    "buttons" "jsonb" DEFAULT '[]'::"jsonb",
    "status" "public"."message_template_status" DEFAULT 'draft'::"public"."message_template_status" NOT NULL,
    "meta_template_id" "text",
    "rejection_reason" "text",
    "last_meta_sync_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."message_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "meta_message_id" "text",
    "conversation_id" "uuid",
    "direction" "public"."message_direction" NOT NULL,
    "type" "public"."message_type" DEFAULT 'text'::"public"."message_type",
    "sender" "text",
    "receiver" "text",
    "text" "text",
    "payload" "jsonb",
    "sent_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "image_url" "text",
    "media_url" "text",
    "media_mime_type" "text",
    "filename" "text",
    "file_size" integer,
    "transcript_text" "text",
    "transcript_status" "text" DEFAULT 'PENDING'::"text",
    "transcript_error" "text",
    "transcript_language" "text",
    "transcript_provider" "text",
    "is_automated" boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY "public"."messages" REPLICA IDENTITY FULL;


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meta_inboxes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clinic_id" "uuid" NOT NULL,
    "channel" "public"."channel_type" NOT NULL,
    "meta_inbox_id" "text" NOT NULL,
    "display_name" "text",
    "page_access_token" "text",
    "token_expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "meta_inboxes_channel_check" CHECK (("channel" = ANY (ARRAY['messenger'::"public"."channel_type", 'instagram'::"public"."channel_type"])))
);


ALTER TABLE "public"."meta_inboxes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quick_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clinic_id" "uuid" NOT NULL,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "quick_messages_message_not_empty" CHECK (("length"("btrim"("message")) > 0))
);


ALTER TABLE "public"."quick_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."send_nonces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "purpose" "text" DEFAULT 'send_message'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone
);


ALTER TABLE "public"."send_nonces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" DEFAULT '#007bff'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "clinic_id" "uuid"
);

ALTER TABLE ONLY "public"."tags" REPLICA IDENTITY FULL;


ALTER TABLE "public"."tags" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_conversations_with_unread" WITH ("security_invoker"='true') AS
 SELECT "c"."id",
    "c"."meta_conversation_id",
    "c"."contact_id",
    "c"."channel",
    "c"."status",
    "c"."assigned_user_id",
    "c"."last_message_at",
    "c"."created_at",
    "c"."updated_at",
    "c"."clinic_id",
    "c"."department_id",
    "c"."whatsapp_number_id",
    "c"."source_entry_point",
    "c"."source_campaign",
    "c"."source_utm",
    "c"."first_inbound_at",
    "c"."first_outbound_at",
    "c"."closed_at",
    "c"."reopened_count",
    COALESCE("ur"."unread_count", 0) AS "unread_count"
   FROM ("public"."conversations" "c"
     LEFT JOIN LATERAL ( SELECT ("count"(*))::integer AS "unread_count"
           FROM ("public"."messages" "m"
             LEFT JOIN "public"."conversation_reads" "cr" ON ((("cr"."conversation_id" = "c"."id") AND ("cr"."user_id" = "auth"."uid"()))))
          WHERE (("m"."conversation_id" = "c"."id") AND ("m"."direction" = 'inbound'::"public"."message_direction") AND ("m"."created_at" > COALESCE("cr"."last_read_at", '1970-01-01 00:00:00+00'::timestamp with time zone)))) "ur" ON (true));


ALTER VIEW "public"."v_conversations_with_unread" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_numbers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clinic_id" "uuid" NOT NULL,
    "meta_phone_number_id" "text" NOT NULL,
    "display_phone_number" "text" NOT NULL,
    "channel_connection_id" "uuid"
);


ALTER TABLE "public"."whatsapp_numbers" OWNER TO "postgres";


ALTER TABLE ONLY "public"."bot_channel_bindings"
    ADD CONSTRAINT "bot_channel_bindings_bot_id_channel_connection_id_key" UNIQUE ("bot_id", "channel_connection_id");



ALTER TABLE ONLY "public"."bot_channel_bindings"
    ADD CONSTRAINT "bot_channel_bindings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bot_nodes"
    ADD CONSTRAINT "bot_nodes_bot_id_node_key_key" UNIQUE ("bot_id", "node_key");



ALTER TABLE ONLY "public"."bot_nodes"
    ADD CONSTRAINT "bot_nodes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bot_options"
    ADD CONSTRAINT "bot_options_bot_node_id_option_value_key" UNIQUE ("bot_node_id", "option_value");



ALTER TABLE ONLY "public"."bot_options"
    ADD CONSTRAINT "bot_options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bots"
    ADD CONSTRAINT "bots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaign_recipients"
    ADD CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."channel_connections"
    ADD CONSTRAINT "channel_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."channel_connections"
    ADD CONSTRAINT "channel_connections_unique_clinic_provider_channel" UNIQUE ("clinic_id", "provider", "channel");



ALTER TABLE ONLY "public"."clinic_users"
    ADD CONSTRAINT "clinic_users_clinic_id_user_id_key" UNIQUE ("clinic_id", "user_id");



ALTER TABLE ONLY "public"."clinic_users"
    ADD CONSTRAINT "clinic_users_clinic_user_uk" UNIQUE ("clinic_id", "user_id");



ALTER TABLE ONLY "public"."clinic_users"
    ADD CONSTRAINT "clinic_users_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."clinic_users"
    ADD CONSTRAINT "clinic_users_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."clinics"
    ADD CONSTRAINT "clinics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_automation_settings"
    ADD CONSTRAINT "conversation_automation_settings_pkey" PRIMARY KEY ("clinic_id");



ALTER TABLE ONLY "public"."conversation_bot_events"
    ADD CONSTRAINT "conversation_bot_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_bot_sessions"
    ADD CONSTRAINT "conversation_bot_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_events"
    ADD CONSTRAINT "conversation_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_reads"
    ADD CONSTRAINT "conversation_reads_pkey" PRIMARY KEY ("conversation_id", "user_id");



ALTER TABLE ONLY "public"."conversation_tags"
    ADD CONSTRAINT "conversation_tags_pkey" PRIMARY KEY ("conversation_id", "tag_id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_meta_conversation_id_key" UNIQUE ("meta_conversation_id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."department_members"
    ADD CONSTRAINT "department_members_pkey" PRIMARY KEY ("department_id", "clinic_user_id");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."edge_rate_limits"
    ADD CONSTRAINT "edge_rate_limits_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."mass_campaigns"
    ADD CONSTRAINT "mass_campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mass_messages_queue"
    ADD CONSTRAINT "mass_messages_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_meta_message_id_key" UNIQUE ("meta_message_id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."meta_inboxes"
    ADD CONSTRAINT "meta_inboxes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quick_messages"
    ADD CONSTRAINT "quick_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."send_nonces"
    ADD CONSTRAINT "send_nonces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transcription_jobs"
    ADD CONSTRAINT "transcription_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_numbers"
    ADD CONSTRAINT "whatsapp_numbers_meta_phone_number_id_key" UNIQUE ("meta_phone_number_id");



ALTER TABLE ONLY "public"."whatsapp_numbers"
    ADD CONSTRAINT "whatsapp_numbers_pkey" PRIMARY KEY ("id");



CREATE INDEX "channel_connections_by_clinic" ON "public"."channel_connections" USING "btree" ("clinic_id", "channel", "provider");



CREATE UNIQUE INDEX "channel_connections_whatsapp_unique_phone" ON "public"."channel_connections" USING "btree" ("provider", "channel", "meta_phone_number_id") WHERE (("channel" = 'whatsapp'::"text") AND ("meta_phone_number_id" IS NOT NULL));



CREATE INDEX "clinic_users_department_idx" ON "public"."clinic_users" USING "btree" ("department_id");



CREATE INDEX "clinic_users_email_idx" ON "public"."clinic_users" USING "btree" ("email");



CREATE UNIQUE INDEX "contacts_clinic_meta_contact_id_uidx" ON "public"."contacts" USING "btree" ("clinic_id", "meta_contact_id");



CREATE INDEX "conversations_department_idx" ON "public"."conversations" USING "btree" ("department_id");



CREATE INDEX "conversations_lookup_active" ON "public"."conversations" USING "btree" ("clinic_id", "contact_id", "channel", "whatsapp_number_id", "last_message_at");



CREATE UNIQUE INDEX "conversations_one_active_per_number" ON "public"."conversations" USING "btree" ("clinic_id", "contact_id", "channel", "whatsapp_number_id") WHERE ("status" = ANY (ARRAY['open'::"public"."conversation_status", 'pending'::"public"."conversation_status"]));



CREATE INDEX "department_members_user_idx" ON "public"."department_members" USING "btree" ("clinic_user_id");



CREATE INDEX "departments_clinic_idx" ON "public"."departments" USING "btree" ("clinic_id");



CREATE UNIQUE INDEX "departments_clinic_slug_uk" ON "public"."departments" USING "btree" ("clinic_id", "slug");



CREATE UNIQUE INDEX "departments_one_default_per_clinic_uk" ON "public"."departments" USING "btree" ("clinic_id") WHERE "is_default";



CREATE INDEX "edge_rate_limits_bucket_idx" ON "public"."edge_rate_limits" USING "btree" ("user_id", "bucket_start");



CREATE INDEX "idx_bot_channel_bindings_channel_connection_id" ON "public"."bot_channel_bindings" USING "btree" ("channel_connection_id");



CREATE INDEX "idx_bot_channel_bindings_clinic_id" ON "public"."bot_channel_bindings" USING "btree" ("clinic_id");



CREATE INDEX "idx_bot_nodes_bot_id" ON "public"."bot_nodes" USING "btree" ("bot_id");



CREATE INDEX "idx_bot_nodes_clinic_id" ON "public"."bot_nodes" USING "btree" ("clinic_id");



CREATE INDEX "idx_bot_options_bot_node_id" ON "public"."bot_options" USING "btree" ("bot_node_id");



CREATE INDEX "idx_bot_options_clinic_id" ON "public"."bot_options" USING "btree" ("clinic_id");



CREATE INDEX "idx_bots_clinic_id" ON "public"."bots" USING "btree" ("clinic_id");



CREATE INDEX "idx_conversation_bot_events_conversation_id" ON "public"."conversation_bot_events" USING "btree" ("conversation_id");



CREATE INDEX "idx_conversation_bot_events_session_id" ON "public"."conversation_bot_events" USING "btree" ("conversation_bot_session_id");



CREATE INDEX "idx_conversation_bot_sessions_bot_id" ON "public"."conversation_bot_sessions" USING "btree" ("bot_id");



CREATE INDEX "idx_conversation_bot_sessions_channel_connection_id" ON "public"."conversation_bot_sessions" USING "btree" ("channel_connection_id");



CREATE INDEX "idx_conversation_bot_sessions_conversation_id" ON "public"."conversation_bot_sessions" USING "btree" ("conversation_id");



CREATE INDEX "idx_conversation_events_conversation" ON "public"."conversation_events" USING "btree" ("conversation_id");



CREATE INDEX "idx_conversation_events_created" ON "public"."conversation_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_conversation_events_type" ON "public"."conversation_events" USING "btree" ("event_type");



CREATE INDEX "idx_conversation_reads_conv" ON "public"."conversation_reads" USING "btree" ("conversation_id");



CREATE INDEX "idx_conversation_reads_user" ON "public"."conversation_reads" USING "btree" ("user_id", "clinic_id");



CREATE INDEX "idx_conversation_tags_conversation" ON "public"."conversation_tags" USING "btree" ("conversation_id");



CREATE INDEX "idx_conversation_tags_conversation_id" ON "public"."conversation_tags" USING "btree" ("conversation_id");



CREATE INDEX "idx_conversation_tags_tag" ON "public"."conversation_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_conversation_tags_tag_id" ON "public"."conversation_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_conversations_assigned_user" ON "public"."conversations" USING "btree" ("assigned_user_id");



CREATE INDEX "idx_conversations_clinic_channel_created" ON "public"."conversations" USING "btree" ("clinic_id", "channel", "created_at");



CREATE INDEX "idx_conversations_clinic_created" ON "public"."conversations" USING "btree" ("clinic_id", "created_at");



CREATE INDEX "idx_conversations_clinic_department_created" ON "public"."conversations" USING "btree" ("clinic_id", "department_id", "created_at");



CREATE INDEX "idx_conversations_clinic_last_message" ON "public"."conversations" USING "btree" ("clinic_id", "last_message_at");



CREATE INDEX "idx_conversations_contact" ON "public"."conversations" USING "btree" ("contact_id");



CREATE INDEX "idx_conversations_status" ON "public"."conversations" USING "btree" ("status");



CREATE INDEX "idx_events_conversation_created" ON "public"."conversation_events" USING "btree" ("conversation_id", "created_at");



CREATE INDEX "idx_events_type_created" ON "public"."conversation_events" USING "btree" ("event_type", "created_at");



CREATE INDEX "idx_messages_conv_inbound_created" ON "public"."messages" USING "btree" ("conversation_id", "created_at") WHERE ("direction" = 'inbound'::"public"."message_direction");



CREATE INDEX "idx_messages_conversation" ON "public"."messages" USING "btree" ("conversation_id");



CREATE INDEX "idx_messages_conversation_created" ON "public"."messages" USING "btree" ("conversation_id", "created_at");



CREATE INDEX "idx_messages_conversation_sent_at" ON "public"."messages" USING "btree" ("conversation_id", "sent_at");



CREATE INDEX "idx_messages_sent_at" ON "public"."messages" USING "btree" ("sent_at");



CREATE INDEX "idx_quick_messages_clinic_created_at" ON "public"."quick_messages" USING "btree" ("clinic_id", "created_at" DESC);



CREATE INDEX "idx_quick_messages_clinic_id" ON "public"."quick_messages" USING "btree" ("clinic_id");



CREATE UNIQUE INDEX "meta_inboxes_channel_inbox_unique" ON "public"."meta_inboxes" USING "btree" ("channel", "meta_inbox_id");



CREATE INDEX "meta_inboxes_clinic_channel_idx" ON "public"."meta_inboxes" USING "btree" ("clinic_id", "channel");



CREATE INDEX "send_nonces_expires_idx" ON "public"."send_nonces" USING "btree" ("expires_at");



CREATE INDEX "send_nonces_lookup_idx" ON "public"."send_nonces" USING "btree" ("user_id", "conversation_id", "expires_at") WHERE ("used_at" IS NULL);



CREATE INDEX "transcription_jobs_message_id_idx" ON "public"."transcription_jobs" USING "btree" ("message_id");



CREATE INDEX "transcription_jobs_status_created_idx" ON "public"."transcription_jobs" USING "btree" ("status", "created_at");



CREATE UNIQUE INDEX "ux_bot_channel_bindings_one_active_per_channel" ON "public"."bot_channel_bindings" USING "btree" ("channel_connection_id") WHERE ("enabled" = true);



CREATE UNIQUE INDEX "ux_conversation_bot_sessions_one_active_per_conversation" ON "public"."conversation_bot_sessions" USING "btree" ("conversation_id") WHERE ("status" = 'active'::"public"."bot_session_status");



CREATE UNIQUE INDEX "ux_quick_messages_clinic_message" ON "public"."quick_messages" USING "btree" ("clinic_id", "md5"("btrim"("message")));



CREATE INDEX "whatsapp_numbers_channel_connection_id_idx" ON "public"."whatsapp_numbers" USING "btree" ("channel_connection_id");



CREATE OR REPLACE TRIGGER "meta_inboxes_set_updated_at" BEFORE UPDATE ON "public"."meta_inboxes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_bot_channel_bindings_set_updated_at" BEFORE UPDATE ON "public"."bot_channel_bindings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_bot_nodes_set_updated_at" BEFORE UPDATE ON "public"."bot_nodes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_bot_options_set_updated_at" BEFORE UPDATE ON "public"."bot_options" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_bots_set_updated_at" BEFORE UPDATE ON "public"."bots" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_conversation_bot_sessions_set_updated_at" BEFORE UPDATE ON "public"."conversation_bot_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_conversations_set_default_department" BEFORE INSERT ON "public"."conversations" FOR EACH ROW EXECUTE FUNCTION "public"."conversations_set_default_department"();



CREATE OR REPLACE TRIGGER "trg_departments_updated_at" BEFORE UPDATE ON "public"."departments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_edge_rate_limits_updated_at" BEFORE UPDATE ON "public"."edge_rate_limits" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_quick_messages_set_updated_at" BEFORE UPDATE ON "public"."quick_messages" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_validate_bot_channel_binding_integrity" BEFORE INSERT OR UPDATE ON "public"."bot_channel_bindings" FOR EACH ROW EXECUTE FUNCTION "public"."validate_bot_channel_binding_integrity"();



CREATE OR REPLACE TRIGGER "trg_validate_bot_node_clinic_integrity" BEFORE INSERT OR UPDATE ON "public"."bot_nodes" FOR EACH ROW EXECUTE FUNCTION "public"."validate_bot_node_clinic_integrity"();



CREATE OR REPLACE TRIGGER "trg_validate_bot_option_clinic_integrity" BEFORE INSERT OR UPDATE ON "public"."bot_options" FOR EACH ROW EXECUTE FUNCTION "public"."validate_bot_option_clinic_integrity"();



CREATE OR REPLACE TRIGGER "trg_validate_bot_option_structure_integrity" BEFORE INSERT OR UPDATE ON "public"."bot_options" FOR EACH ROW EXECUTE FUNCTION "public"."validate_bot_option_structure_integrity"();



CREATE OR REPLACE TRIGGER "trg_validate_conversation_bot_event_integrity" BEFORE INSERT OR UPDATE ON "public"."conversation_bot_events" FOR EACH ROW EXECUTE FUNCTION "public"."validate_conversation_bot_event_integrity"();



CREATE OR REPLACE TRIGGER "trg_validate_conversation_bot_event_structure_integrity" BEFORE INSERT OR UPDATE ON "public"."conversation_bot_events" FOR EACH ROW EXECUTE FUNCTION "public"."validate_conversation_bot_event_structure_integrity"();



CREATE OR REPLACE TRIGGER "trg_validate_conversation_bot_session_integrity" BEFORE INSERT OR UPDATE ON "public"."conversation_bot_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."validate_conversation_bot_session_integrity"();



CREATE OR REPLACE TRIGGER "trg_validate_conversation_bot_session_structure_integrity" BEFORE INSERT OR UPDATE ON "public"."conversation_bot_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."validate_conversation_bot_session_structure_integrity"();



ALTER TABLE ONLY "public"."bot_channel_bindings"
    ADD CONSTRAINT "bot_channel_bindings_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bot_channel_bindings"
    ADD CONSTRAINT "bot_channel_bindings_channel_connection_id_fkey" FOREIGN KEY ("channel_connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bot_channel_bindings"
    ADD CONSTRAINT "bot_channel_bindings_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bot_channel_bindings"
    ADD CONSTRAINT "bot_channel_bindings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bot_nodes"
    ADD CONSTRAINT "bot_nodes_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bot_nodes"
    ADD CONSTRAINT "bot_nodes_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bot_options"
    ADD CONSTRAINT "bot_options_bot_node_id_fkey" FOREIGN KEY ("bot_node_id") REFERENCES "public"."bot_nodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bot_options"
    ADD CONSTRAINT "bot_options_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bot_options"
    ADD CONSTRAINT "bot_options_next_node_id_fkey" FOREIGN KEY ("next_node_id") REFERENCES "public"."bot_nodes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bot_options"
    ADD CONSTRAINT "bot_options_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bot_options"
    ADD CONSTRAINT "bot_options_target_department_id_fkey" FOREIGN KEY ("target_department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bots"
    ADD CONSTRAINT "bots_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bots"
    ADD CONSTRAINT "bots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."campaign_recipients"
    ADD CONSTRAINT "campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_recipients"
    ADD CONSTRAINT "campaign_recipients_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_recipients"
    ADD CONSTRAINT "campaign_recipients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_recipients"
    ADD CONSTRAINT "campaign_recipients_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_whatsapp_number_id_fkey" FOREIGN KEY ("whatsapp_number_id") REFERENCES "public"."whatsapp_numbers"("id");



ALTER TABLE ONLY "public"."channel_connections"
    ADD CONSTRAINT "channel_connections_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clinic_users"
    ADD CONSTRAINT "clinic_users_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clinic_users"
    ADD CONSTRAINT "clinic_users_department_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clinic_users"
    ADD CONSTRAINT "clinic_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id");



ALTER TABLE ONLY "public"."conversation_automation_settings"
    ADD CONSTRAINT "conversation_automation_settings_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id");



ALTER TABLE ONLY "public"."conversation_bot_events"
    ADD CONSTRAINT "conversation_bot_events_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_bot_events"
    ADD CONSTRAINT "conversation_bot_events_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_bot_events"
    ADD CONSTRAINT "conversation_bot_events_conversation_bot_session_id_fkey" FOREIGN KEY ("conversation_bot_session_id") REFERENCES "public"."conversation_bot_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_bot_events"
    ADD CONSTRAINT "conversation_bot_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_bot_events"
    ADD CONSTRAINT "conversation_bot_events_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "public"."bot_nodes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversation_bot_events"
    ADD CONSTRAINT "conversation_bot_events_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "public"."bot_options"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversation_bot_sessions"
    ADD CONSTRAINT "conversation_bot_sessions_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_bot_sessions"
    ADD CONSTRAINT "conversation_bot_sessions_channel_connection_id_fkey" FOREIGN KEY ("channel_connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_bot_sessions"
    ADD CONSTRAINT "conversation_bot_sessions_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_bot_sessions"
    ADD CONSTRAINT "conversation_bot_sessions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_bot_sessions"
    ADD CONSTRAINT "conversation_bot_sessions_current_node_id_fkey" FOREIGN KEY ("current_node_id") REFERENCES "public"."bot_nodes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversation_events"
    ADD CONSTRAINT "conversation_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_events"
    ADD CONSTRAINT "conversation_events_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."conversation_reads"
    ADD CONSTRAINT "conversation_reads_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_reads"
    ADD CONSTRAINT "conversation_reads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_reads"
    ADD CONSTRAINT "conversation_reads_last_read_message_id_fkey" FOREIGN KEY ("last_read_message_id") REFERENCES "public"."messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversation_reads"
    ADD CONSTRAINT "conversation_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_tags"
    ADD CONSTRAINT "conversation_tags_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_tags"
    ADD CONSTRAINT "conversation_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_assigned_user_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."clinic_users"("user_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_assigned_user_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."clinic_users"("user_id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_assigned_user_in_clinic_fk" FOREIGN KEY ("clinic_id", "assigned_user_id") REFERENCES "public"."clinic_users"("clinic_id", "user_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_assigned_user_in_clinic_fkey" FOREIGN KEY ("clinic_id", "assigned_user_id") REFERENCES "public"."clinic_users"("clinic_id", "user_id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_channel_connection_id_fkey" FOREIGN KEY ("channel_connection_id") REFERENCES "public"."channel_connections"("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_department_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_whatsapp_number_fk" FOREIGN KEY ("whatsapp_number_id") REFERENCES "public"."whatsapp_numbers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."department_members"
    ADD CONSTRAINT "department_members_clinic_user_id_fkey" FOREIGN KEY ("clinic_user_id") REFERENCES "public"."clinic_users"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_members"
    ADD CONSTRAINT "department_members_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mass_messages_queue"
    ADD CONSTRAINT "mass_messages_queue_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."mass_campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_whatsapp_number_id_fkey" FOREIGN KEY ("whatsapp_number_id") REFERENCES "public"."whatsapp_numbers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meta_inboxes"
    ADD CONSTRAINT "meta_inboxes_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quick_messages"
    ADD CONSTRAINT "quick_messages_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id");



ALTER TABLE ONLY "public"."transcription_jobs"
    ADD CONSTRAINT "transcription_jobs_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_numbers"
    ADD CONSTRAINT "whatsapp_numbers_channel_connection_id_fkey" FOREIGN KEY ("channel_connection_id") REFERENCES "public"."channel_connections"("id");



ALTER TABLE ONLY "public"."whatsapp_numbers"
    ADD CONSTRAINT "whatsapp_numbers_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE CASCADE;



CREATE POLICY "Permitir tudo para usuários autenticados" ON "public"."mass_campaigns" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Permitir tudo para usuários autenticados" ON "public"."mass_messages_queue" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "admins can view clinics" ON "public"."clinics" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "clinics"."id") AND ("cu"."role" = 'admin'::"text")))));



CREATE POLICY "allow insert messages for authenticated" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK (true);



ALTER TABLE "public"."bot_channel_bindings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bot_channel_bindings_delete" ON "public"."bot_channel_bindings" FOR DELETE USING ("public"."user_can_manage_clinic"("clinic_id"));



CREATE POLICY "bot_channel_bindings_insert" ON "public"."bot_channel_bindings" FOR INSERT WITH CHECK ("public"."user_can_manage_clinic"("clinic_id"));



CREATE POLICY "bot_channel_bindings_select" ON "public"."bot_channel_bindings" FOR SELECT USING ("public"."user_belongs_to_clinic"("clinic_id"));



CREATE POLICY "bot_channel_bindings_update" ON "public"."bot_channel_bindings" FOR UPDATE USING ("public"."user_can_manage_clinic"("clinic_id")) WITH CHECK ("public"."user_can_manage_clinic"("clinic_id"));



ALTER TABLE "public"."bot_nodes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bot_nodes_delete" ON "public"."bot_nodes" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "bot_nodes"."clinic_id")))));



CREATE POLICY "bot_nodes_insert" ON "public"."bot_nodes" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "bot_nodes"."clinic_id")))) AND (EXISTS ( SELECT 1
   FROM "public"."bots" "b"
  WHERE (("b"."id" = "bot_nodes"."bot_id") AND ("b"."clinic_id" = "bot_nodes"."clinic_id"))))));



CREATE POLICY "bot_nodes_select" ON "public"."bot_nodes" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "bot_nodes"."clinic_id")))));



CREATE POLICY "bot_nodes_update" ON "public"."bot_nodes" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "bot_nodes"."clinic_id"))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "bot_nodes"."clinic_id")))) AND (EXISTS ( SELECT 1
   FROM "public"."bots" "b"
  WHERE (("b"."id" = "bot_nodes"."bot_id") AND ("b"."clinic_id" = "bot_nodes"."clinic_id"))))));



ALTER TABLE "public"."bot_options" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bot_options_delete" ON "public"."bot_options" FOR DELETE USING ("public"."user_can_manage_clinic"("clinic_id"));



CREATE POLICY "bot_options_insert" ON "public"."bot_options" FOR INSERT WITH CHECK ("public"."user_can_manage_clinic"("clinic_id"));



CREATE POLICY "bot_options_select" ON "public"."bot_options" FOR SELECT USING ("public"."user_belongs_to_clinic"("clinic_id"));



CREATE POLICY "bot_options_update" ON "public"."bot_options" FOR UPDATE USING ("public"."user_can_manage_clinic"("clinic_id")) WITH CHECK ("public"."user_can_manage_clinic"("clinic_id"));



ALTER TABLE "public"."bots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bots_delete" ON "public"."bots" FOR DELETE USING ("public"."user_can_manage_clinic"("clinic_id"));



CREATE POLICY "bots_insert" ON "public"."bots" FOR INSERT WITH CHECK ("public"."user_can_manage_clinic"("clinic_id"));



CREATE POLICY "bots_select" ON "public"."bots" FOR SELECT USING ("public"."user_belongs_to_clinic"("clinic_id"));



CREATE POLICY "bots_update" ON "public"."bots" FOR UPDATE USING ("public"."user_can_manage_clinic"("clinic_id")) WITH CHECK ("public"."user_can_manage_clinic"("clinic_id"));



ALTER TABLE "public"."campaign_recipients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."campaigns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."channel_connections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "channel_connections_delete_admin_only" ON "public"."channel_connections" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "channel_connections"."clinic_id") AND ("cu"."user_id" = "auth"."uid"()) AND ("cu"."role" = 'admin'::"text")))));



CREATE POLICY "channel_connections_insert_admin_only" ON "public"."channel_connections" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "channel_connections"."clinic_id") AND ("cu"."user_id" = "auth"."uid"()) AND ("cu"."role" = 'admin'::"text")))));



CREATE POLICY "channel_connections_select_by_clinic_members" ON "public"."channel_connections" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "channel_connections"."clinic_id") AND ("cu"."user_id" = "auth"."uid"())))));



CREATE POLICY "channel_connections_update_admin_only" ON "public"."channel_connections" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "channel_connections"."clinic_id") AND ("cu"."user_id" = "auth"."uid"()) AND ("cu"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "channel_connections"."clinic_id") AND ("cu"."user_id" = "auth"."uid"()) AND ("cu"."role" = 'admin'::"text")))));



CREATE POLICY "clinic admin can update clinic_users" ON "public"."clinic_users" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "clinic_users"."clinic_id") AND ("cu"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "clinic_users"."clinic_id") AND ("cu"."role" = 'admin'::"text")))));



CREATE POLICY "clinic admins read their whatsapp numbers" ON "public"."whatsapp_numbers" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "whatsapp_numbers"."clinic_id") AND ("cu"."role" = 'admin'::"text")))));



CREATE POLICY "clinic members read contacts" ON "public"."contacts" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "contacts"."clinic_id")))));



CREATE POLICY "clinic members read conversations" ON "public"."conversations" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "conversations"."clinic_id")))));



CREATE POLICY "clinic members read messages" ON "public"."messages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."conversations" "c"
     JOIN "public"."clinic_users" "cu" ON (("cu"."clinic_id" = "c"."clinic_id")))
  WHERE (("c"."id" = "messages"."conversation_id") AND ("cu"."user_id" = "auth"."uid"())))));



CREATE POLICY "clinic users can manage campaign recipients" ON "public"."campaign_recipients" USING (("clinic_id" IN ( SELECT "clinic_users"."clinic_id"
   FROM "public"."clinic_users"
  WHERE ("clinic_users"."user_id" = "auth"."uid"()))));



CREATE POLICY "clinic users can manage campaigns" ON "public"."campaigns" USING (("clinic_id" IN ( SELECT "clinic_users"."clinic_id"
   FROM "public"."clinic_users"
  WHERE ("clinic_users"."user_id" = "auth"."uid"()))));



CREATE POLICY "clinic users can manage templates" ON "public"."message_templates" USING (("clinic_id" IN ( SELECT "clinic_users"."clinic_id"
   FROM "public"."clinic_users"
  WHERE ("clinic_users"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."clinic_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clinic_users_delete_own" ON "public"."clinic_users" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "clinic_users_insert_own" ON "public"."clinic_users" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "clinic_users_select_same_clinic" ON "public"."clinic_users" FOR SELECT TO "authenticated" USING ("public"."is_clinic_member"("clinic_id"));



CREATE POLICY "clinic_users_update_own" ON "public"."clinic_users" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."clinics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contacts_insert_authenticated" ON "public"."contacts" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "contacts_select_by_visible_conversations" ON "public"."contacts" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") AND ("id" IN ( SELECT "conversations"."contact_id"
   FROM "public"."conversations"
  WHERE (("conversations"."assigned_user_id" IS NULL) OR ("conversations"."assigned_user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."conversation_automation_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversation_automation_settings_delete" ON "public"."conversation_automation_settings" FOR DELETE USING ((("clinic_id" = "public"."current_clinic_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "conversation_automation_settings"."clinic_id") AND ("cu"."role" = 'admin'::"text"))))));



CREATE POLICY "conversation_automation_settings_insert" ON "public"."conversation_automation_settings" FOR INSERT WITH CHECK ((("clinic_id" = "public"."current_clinic_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "conversation_automation_settings"."clinic_id") AND ("cu"."role" = 'admin'::"text"))))));



CREATE POLICY "conversation_automation_settings_select" ON "public"."conversation_automation_settings" FOR SELECT USING (("clinic_id" = "public"."current_clinic_id"()));



CREATE POLICY "conversation_automation_settings_update" ON "public"."conversation_automation_settings" FOR UPDATE USING ((("clinic_id" = "public"."current_clinic_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "conversation_automation_settings"."clinic_id") AND ("cu"."role" = 'admin'::"text")))))) WITH CHECK ((("clinic_id" = "public"."current_clinic_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "conversation_automation_settings"."clinic_id") AND ("cu"."role" = 'admin'::"text"))))));



ALTER TABLE "public"."conversation_bot_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversation_bot_events_delete" ON "public"."conversation_bot_events" FOR DELETE USING ("public"."user_can_manage_clinic"("clinic_id"));



CREATE POLICY "conversation_bot_events_insert" ON "public"."conversation_bot_events" FOR INSERT WITH CHECK ("public"."user_belongs_to_clinic"("clinic_id"));



CREATE POLICY "conversation_bot_events_select" ON "public"."conversation_bot_events" FOR SELECT USING ("public"."user_belongs_to_clinic"("clinic_id"));



ALTER TABLE "public"."conversation_bot_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversation_bot_sessions_delete" ON "public"."conversation_bot_sessions" FOR DELETE USING ("public"."user_can_manage_clinic"("clinic_id"));



CREATE POLICY "conversation_bot_sessions_insert" ON "public"."conversation_bot_sessions" FOR INSERT WITH CHECK ("public"."user_belongs_to_clinic"("clinic_id"));



CREATE POLICY "conversation_bot_sessions_select" ON "public"."conversation_bot_sessions" FOR SELECT USING ("public"."user_belongs_to_clinic"("clinic_id"));



CREATE POLICY "conversation_bot_sessions_update" ON "public"."conversation_bot_sessions" FOR UPDATE USING ("public"."user_belongs_to_clinic"("clinic_id")) WITH CHECK ("public"."user_belongs_to_clinic"("clinic_id"));



ALTER TABLE "public"."conversation_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversation_events_insert_by_clinic" ON "public"."conversation_events" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."conversations" "c"
     JOIN "public"."clinic_users" "cu" ON (("cu"."clinic_id" = "c"."clinic_id")))
  WHERE (("c"."id" = "conversation_events"."conversation_id") AND ("cu"."user_id" = "auth"."uid"())))));



CREATE POLICY "conversation_events_select_by_clinic" ON "public"."conversation_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."conversations" "c"
     JOIN "public"."clinic_users" "cu" ON (("cu"."clinic_id" = "c"."clinic_id")))
  WHERE (("c"."id" = "conversation_events"."conversation_id") AND ("cu"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."conversation_reads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversation_reads_delete_own" ON "public"."conversation_reads" FOR DELETE USING ((("user_id" = "auth"."uid"()) AND ("clinic_id" = "public"."current_clinic_id"())));



CREATE POLICY "conversation_reads_insert_own" ON "public"."conversation_reads" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND ("clinic_id" = "public"."current_clinic_id"()) AND "public"."user_can_access_conversation"("conversation_id")));



CREATE POLICY "conversation_reads_select_own" ON "public"."conversation_reads" FOR SELECT USING ((("user_id" = "auth"."uid"()) AND ("clinic_id" = "public"."current_clinic_id"()) AND "public"."user_can_access_conversation"("conversation_id")));



CREATE POLICY "conversation_reads_update_own" ON "public"."conversation_reads" FOR UPDATE USING ((("user_id" = "auth"."uid"()) AND ("clinic_id" = "public"."current_clinic_id"()) AND "public"."user_can_access_conversation"("conversation_id"))) WITH CHECK ((("user_id" = "auth"."uid"()) AND ("clinic_id" = "public"."current_clinic_id"()) AND "public"."user_can_access_conversation"("conversation_id")));



ALTER TABLE "public"."conversation_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversation_tags_delete" ON "public"."conversation_tags" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ("public"."conversations" "c"
     JOIN "public"."clinic_users" "cu" ON (("cu"."clinic_id" = "c"."clinic_id")))
  WHERE (("c"."id" = "conversation_tags"."conversation_id") AND ("cu"."user_id" = "auth"."uid"())))));



CREATE POLICY "conversation_tags_insert" ON "public"."conversation_tags" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."conversations" "c"
     JOIN "public"."clinic_users" "cu" ON (("cu"."clinic_id" = "c"."clinic_id")))
     JOIN "public"."tags" "t" ON (("t"."id" = "conversation_tags"."tag_id")))
  WHERE (("c"."id" = "conversation_tags"."conversation_id") AND ("cu"."user_id" = "auth"."uid"()) AND ("t"."clinic_id" = "c"."clinic_id")))));



CREATE POLICY "conversation_tags_insert_owned" ON "public"."conversation_tags" FOR INSERT WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND ("conversation_id" IN ( SELECT "conversations"."id"
   FROM "public"."conversations"
  WHERE ("conversations"."assigned_user_id" = "auth"."uid"())))));



CREATE POLICY "conversation_tags_select" ON "public"."conversation_tags" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."conversations" "c"
     JOIN "public"."clinic_users" "cu" ON (("cu"."clinic_id" = "c"."clinic_id")))
  WHERE (("c"."id" = "conversation_tags"."conversation_id") AND ("cu"."user_id" = "auth"."uid"())))));



CREATE POLICY "conversation_tags_select_visible" ON "public"."conversation_tags" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") AND ("conversation_id" IN ( SELECT "conversations"."id"
   FROM "public"."conversations"
  WHERE (("conversations"."assigned_user_id" IS NULL) OR ("conversations"."assigned_user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversations_by_clinic" ON "public"."conversations" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "conversations"."clinic_id")))));



CREATE POLICY "conversations_insert_authenticated" ON "public"."conversations" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "conversations_select_available_or_owned" ON "public"."conversations" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") AND (("assigned_user_id" IS NULL) OR ("assigned_user_id" = "auth"."uid"()))));



CREATE POLICY "conversations_select_clinic_members" ON "public"."conversations" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "conversations"."clinic_id")))));



CREATE POLICY "conversations_update_assign_or_own" ON "public"."conversations" FOR UPDATE USING ((("auth"."role"() = 'authenticated'::"text") AND (("assigned_user_id" IS NULL) OR ("assigned_user_id" = "auth"."uid"())))) WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND ("assigned_user_id" = "auth"."uid"())));



ALTER TABLE "public"."department_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "department_members_select_same_clinic" ON "public"."department_members" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."departments" "d"
  WHERE (("d"."id" = "department_members"."department_id") AND "public"."is_clinic_member"("d"."clinic_id")))));



ALTER TABLE "public"."departments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "departments_delete_admin_same_clinic" ON "public"."departments" FOR DELETE TO "authenticated" USING (("public"."is_clinic_admin"() AND ("clinic_id" = "public"."current_clinic_id"())));



CREATE POLICY "departments_insert_admin_same_clinic" ON "public"."departments" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_clinic_admin"() AND ("clinic_id" = "public"."current_clinic_id"())));



CREATE POLICY "departments_select_same_clinic" ON "public"."departments" FOR SELECT TO "authenticated" USING ("public"."is_clinic_member"("clinic_id"));



CREATE POLICY "departments_update_admin_same_clinic" ON "public"."departments" FOR UPDATE TO "authenticated" USING (("public"."is_clinic_admin"() AND ("clinic_id" = "public"."current_clinic_id"()))) WITH CHECK (("public"."is_clinic_admin"() AND ("clinic_id" = "public"."current_clinic_id"())));



CREATE POLICY "dept_members_delete_admin_same_clinic" ON "public"."department_members" FOR DELETE TO "authenticated" USING (("public"."is_clinic_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."departments" "d"
  WHERE (("d"."id" = "department_members"."department_id") AND ("d"."clinic_id" = "public"."current_clinic_id"()))))));



CREATE POLICY "dept_members_insert_admin_same_clinic" ON "public"."department_members" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_clinic_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."departments" "d"
  WHERE (("d"."id" = "department_members"."department_id") AND ("d"."clinic_id" = "public"."current_clinic_id"())))) AND (EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "department_members"."clinic_user_id") AND ("cu"."clinic_id" = "public"."current_clinic_id"()))))));



CREATE POLICY "dept_members_select_same_clinic" ON "public"."department_members" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."departments" "d"
  WHERE (("d"."id" = "department_members"."department_id") AND ("d"."clinic_id" = "public"."current_clinic_id"())))));



CREATE POLICY "dept_members_update_admin_same_clinic" ON "public"."department_members" FOR UPDATE TO "authenticated" USING (("public"."is_clinic_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."departments" "d"
  WHERE (("d"."id" = "department_members"."department_id") AND ("d"."clinic_id" = "public"."current_clinic_id"())))))) WITH CHECK (("public"."is_clinic_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."departments" "d"
  WHERE (("d"."id" = "department_members"."department_id") AND ("d"."clinic_id" = "public"."current_clinic_id"())))) AND (EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "department_members"."clinic_user_id") AND ("cu"."clinic_id" = "public"."current_clinic_id"()))))));



ALTER TABLE "public"."edge_rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mass_campaigns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mass_messages_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."message_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "messages_insert_owned_conversations" ON "public"."messages" FOR INSERT WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND ("conversation_id" IN ( SELECT "conversations"."id"
   FROM "public"."conversations"
  WHERE ("conversations"."assigned_user_id" = "auth"."uid"())))));



CREATE POLICY "messages_select_available_or_owned_conversations" ON "public"."messages" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") AND ("conversation_id" IN ( SELECT "conversations"."id"
   FROM "public"."conversations"
  WHERE (("conversations"."assigned_user_id" IS NULL) OR ("conversations"."assigned_user_id" = "auth"."uid"()))))));



CREATE POLICY "messages_select_via_conversation_access" ON "public"."messages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."conversations" "c"
     JOIN "public"."clinic_users" "cu" ON ((("cu"."clinic_id" = "c"."clinic_id") AND ("cu"."user_id" = "auth"."uid"()))))
  WHERE (("c"."id" = "messages"."conversation_id") AND ("c"."status" <> 'closed'::"public"."conversation_status") AND (("c"."status" = 'pending'::"public"."conversation_status") OR (("c"."status" = 'open'::"public"."conversation_status") AND ("c"."assigned_user_id" = "auth"."uid"())))))));



ALTER TABLE "public"."meta_inboxes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "meta_inboxes_delete" ON "public"."meta_inboxes" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "meta_inboxes"."clinic_id") AND ("cu"."user_id" = "auth"."uid"())))));



CREATE POLICY "meta_inboxes_insert" ON "public"."meta_inboxes" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "meta_inboxes"."clinic_id") AND ("cu"."user_id" = "auth"."uid"())))));



CREATE POLICY "meta_inboxes_select" ON "public"."meta_inboxes" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "meta_inboxes"."clinic_id") AND ("cu"."user_id" = "auth"."uid"())))));



CREATE POLICY "meta_inboxes_update" ON "public"."meta_inboxes" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "meta_inboxes"."clinic_id") AND ("cu"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "meta_inboxes"."clinic_id") AND ("cu"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."quick_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "quick_messages_delete_admin_only" ON "public"."quick_messages" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "quick_messages"."clinic_id") AND ("cu"."user_id" = "auth"."uid"()) AND ("cu"."role" = 'admin'::"text")))));



CREATE POLICY "quick_messages_insert_admin_only" ON "public"."quick_messages" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "quick_messages"."clinic_id") AND ("cu"."user_id" = "auth"."uid"()) AND ("cu"."role" = 'admin'::"text")))));



CREATE POLICY "quick_messages_select_clinic_users" ON "public"."quick_messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "quick_messages"."clinic_id") AND ("cu"."user_id" = "auth"."uid"())))));



CREATE POLICY "quick_messages_update_admin_only" ON "public"."quick_messages" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "quick_messages"."clinic_id") AND ("cu"."user_id" = "auth"."uid"()) AND ("cu"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "quick_messages"."clinic_id") AND ("cu"."user_id" = "auth"."uid"()) AND ("cu"."role" = 'admin'::"text")))));



ALTER TABLE "public"."send_nonces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tags_delete_clinic_members" ON "public"."tags" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "tags"."clinic_id")))));



CREATE POLICY "tags_insert_authenticated" ON "public"."tags" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "tags_insert_clinic_members" ON "public"."tags" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "tags"."clinic_id")))));



CREATE POLICY "tags_select_authenticated" ON "public"."tags" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "tags_select_clinic_members" ON "public"."tags" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "tags"."clinic_id")))));



CREATE POLICY "tags_update_clinic_members" ON "public"."tags" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "tags"."clinic_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "tags"."clinic_id")))));



ALTER TABLE "public"."transcription_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users read contacts from their clinic" ON "public"."contacts" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "contacts"."clinic_id")))));



CREATE POLICY "users read conversations from their clinic" ON "public"."conversations" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."user_id" = "auth"."uid"()) AND ("cu"."clinic_id" = "conversations"."clinic_id")))));



CREATE POLICY "users read messages from their clinic" ON "public"."messages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."conversations" "c"
     JOIN "public"."clinic_users" "cu" ON (("cu"."clinic_id" = "c"."clinic_id")))
  WHERE (("c"."id" = "messages"."conversation_id") AND ("cu"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."whatsapp_numbers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "whatsapp_numbers_select_by_clinic_members" ON "public"."whatsapp_numbers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "whatsapp_numbers"."clinic_id") AND ("cu"."user_id" = "auth"."uid"())))));



CREATE POLICY "whatsapp_numbers_write_admin_only" ON "public"."whatsapp_numbers" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "whatsapp_numbers"."clinic_id") AND ("cu"."user_id" = "auth"."uid"()) AND ("cu"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."clinic_users" "cu"
  WHERE (("cu"."clinic_id" = "whatsapp_numbers"."clinic_id") AND ("cu"."user_id" = "auth"."uid"()) AND ("cu"."role" = 'admin'::"text")))));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON TABLE "public"."transcription_jobs" TO "anon";
GRANT ALL ON TABLE "public"."transcription_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."transcription_jobs" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_transcription_jobs"("batch_size" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_transcription_jobs"("batch_size" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_transcription_jobs"("batch_size" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."conversations_set_default_department"() TO "anon";
GRANT ALL ON FUNCTION "public"."conversations_set_default_department"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."conversations_set_default_department"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_clinic_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_clinic_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_clinic_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_message"("queue_name" "text", "msg" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_message"("queue_name" "text", "msg" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_message"("queue_name" "text", "msg" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_message_batch"("queue_name" "text", "msgs" "jsonb"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_message_batch"("queue_name" "text", "msgs" "jsonb"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_message_batch"("queue_name" "text", "msgs" "jsonb"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_unread_counts"("p_user_id" "uuid", "p_conversation_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_unread_counts"("p_user_id" "uuid", "p_conversation_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unread_counts"("p_user_id" "uuid", "p_conversation_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_clinic_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_clinic_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_clinic_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_clinic_member"("p_clinic_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_clinic_member"("p_clinic_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_clinic_member"("p_clinic_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_clinic_member"("p_clinic_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_org_admin"("org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_org_admin"("org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_admin"("org" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_org_member"("org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_org_member"("org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_member"("org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."job_conversation_auto_close"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."job_conversation_auto_close"() TO "anon";
GRANT ALL ON FUNCTION "public"."job_conversation_auto_close"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."job_conversation_auto_close"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."job_conversation_return_to_pending"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."job_conversation_return_to_pending"() TO "anon";
GRANT ALL ON FUNCTION "public"."job_conversation_return_to_pending"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."job_conversation_return_to_pending"() TO "service_role";



GRANT ALL ON FUNCTION "public"."job_conversation_sla_first_response"() TO "anon";
GRANT ALL ON FUNCTION "public"."job_conversation_sla_first_response"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."job_conversation_sla_first_response"() TO "service_role";



GRANT ALL ON FUNCTION "public"."list_conversations_with_unread"("p_user_id" "uuid", "p_department_id" "uuid", "p_mode" "text", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."list_conversations_with_unread"("p_user_id" "uuid", "p_department_id" "uuid", "p_mode" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_conversations_with_unread"("p_user_id" "uuid", "p_department_id" "uuid", "p_mode" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."list_conversations_with_unread"("p_user_id" "uuid", "p_clinic_id" "uuid", "p_department_ids" "uuid"[], "p_mode" "text", "p_channel" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."list_conversations_with_unread"("p_user_id" "uuid", "p_clinic_id" "uuid", "p_department_ids" "uuid"[], "p_mode" "text", "p_channel" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_conversations_with_unread"("p_user_id" "uuid", "p_clinic_id" "uuid", "p_department_ids" "uuid"[], "p_mode" "text", "p_channel" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_conversation_read"("p_conversation_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_conversation_read"("p_conversation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_conversation_read"("p_conversation_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_conversation_read"("p_conversation_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_conversation_read"("p_conversation_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_conversation_read"("p_conversation_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."on_conversation_status_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_conversation_status_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_conversation_status_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."on_message_after_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_message_after_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_message_after_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."send_mass_messages_to_queue"("p_queue_name" "text", "p_msgs" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."send_mass_messages_to_queue"("p_queue_name" "text", "p_msgs" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_mass_messages_to_queue"("p_queue_name" "text", "p_msgs" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."user_belongs_to_clinic"("target_clinic_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_belongs_to_clinic"("target_clinic_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_belongs_to_clinic"("target_clinic_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."user_can_access_conversation"("target_conversation_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_can_access_conversation"("target_conversation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_can_access_conversation"("target_conversation_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."user_can_manage_clinic"("target_clinic_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_can_manage_clinic"("target_clinic_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_can_manage_clinic"("target_clinic_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_bot_channel_binding_integrity"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_bot_channel_binding_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_bot_channel_binding_integrity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_bot_node_clinic_integrity"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_bot_node_clinic_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_bot_node_clinic_integrity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_bot_option_clinic_integrity"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_bot_option_clinic_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_bot_option_clinic_integrity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_bot_option_structure_integrity"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_bot_option_structure_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_bot_option_structure_integrity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_conversation_bot_event_integrity"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_conversation_bot_event_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_conversation_bot_event_integrity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_conversation_bot_event_structure_integrity"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_conversation_bot_event_structure_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_conversation_bot_event_structure_integrity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_conversation_bot_session_integrity"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_conversation_bot_session_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_conversation_bot_session_integrity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_conversation_bot_session_structure_integrity"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_conversation_bot_session_structure_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_conversation_bot_session_structure_integrity"() TO "service_role";



GRANT ALL ON TABLE "public"."bot_channel_bindings" TO "anon";
GRANT ALL ON TABLE "public"."bot_channel_bindings" TO "authenticated";
GRANT ALL ON TABLE "public"."bot_channel_bindings" TO "service_role";



GRANT ALL ON TABLE "public"."bot_nodes" TO "anon";
GRANT ALL ON TABLE "public"."bot_nodes" TO "authenticated";
GRANT ALL ON TABLE "public"."bot_nodes" TO "service_role";



GRANT ALL ON TABLE "public"."bot_options" TO "anon";
GRANT ALL ON TABLE "public"."bot_options" TO "authenticated";
GRANT ALL ON TABLE "public"."bot_options" TO "service_role";



GRANT ALL ON TABLE "public"."bots" TO "anon";
GRANT ALL ON TABLE "public"."bots" TO "authenticated";
GRANT ALL ON TABLE "public"."bots" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_recipients" TO "anon";
GRANT ALL ON TABLE "public"."campaign_recipients" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_recipients" TO "service_role";



GRANT ALL ON TABLE "public"."campaigns" TO "anon";
GRANT ALL ON TABLE "public"."campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."channel_connections" TO "anon";
GRANT ALL ON TABLE "public"."channel_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."channel_connections" TO "service_role";



GRANT ALL ON TABLE "public"."clinic_users" TO "anon";
GRANT ALL ON TABLE "public"."clinic_users" TO "authenticated";
GRANT ALL ON TABLE "public"."clinic_users" TO "service_role";



GRANT ALL ON TABLE "public"."clinics" TO "anon";
GRANT ALL ON TABLE "public"."clinics" TO "authenticated";
GRANT ALL ON TABLE "public"."clinics" TO "service_role";



GRANT ALL ON TABLE "public"."contacts" TO "anon";
GRANT ALL ON TABLE "public"."contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."contacts" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_automation_settings" TO "anon";
GRANT ALL ON TABLE "public"."conversation_automation_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_automation_settings" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_bot_events" TO "anon";
GRANT ALL ON TABLE "public"."conversation_bot_events" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_bot_events" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_bot_sessions" TO "anon";
GRANT ALL ON TABLE "public"."conversation_bot_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_bot_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_events" TO "anon";
GRANT ALL ON TABLE "public"."conversation_events" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_events" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_reads" TO "anon";
GRANT ALL ON TABLE "public"."conversation_reads" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_reads" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_tags" TO "anon";
GRANT ALL ON TABLE "public"."conversation_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_tags" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."department_members" TO "anon";
GRANT ALL ON TABLE "public"."department_members" TO "authenticated";
GRANT ALL ON TABLE "public"."department_members" TO "service_role";



GRANT ALL ON TABLE "public"."departments" TO "anon";
GRANT ALL ON TABLE "public"."departments" TO "authenticated";
GRANT ALL ON TABLE "public"."departments" TO "service_role";



GRANT ALL ON TABLE "public"."edge_rate_limits" TO "anon";
GRANT ALL ON TABLE "public"."edge_rate_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."edge_rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."mass_campaigns" TO "anon";
GRANT ALL ON TABLE "public"."mass_campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."mass_campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."mass_messages_queue" TO "anon";
GRANT ALL ON TABLE "public"."mass_messages_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."mass_messages_queue" TO "service_role";



GRANT ALL ON TABLE "public"."message_templates" TO "anon";
GRANT ALL ON TABLE "public"."message_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."message_templates" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."meta_inboxes" TO "anon";
GRANT ALL ON TABLE "public"."meta_inboxes" TO "authenticated";
GRANT ALL ON TABLE "public"."meta_inboxes" TO "service_role";



GRANT ALL ON TABLE "public"."quick_messages" TO "anon";
GRANT ALL ON TABLE "public"."quick_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."quick_messages" TO "service_role";



GRANT ALL ON TABLE "public"."send_nonces" TO "anon";
GRANT ALL ON TABLE "public"."send_nonces" TO "authenticated";
GRANT ALL ON TABLE "public"."send_nonces" TO "service_role";



GRANT ALL ON TABLE "public"."tags" TO "anon";
GRANT ALL ON TABLE "public"."tags" TO "authenticated";
GRANT ALL ON TABLE "public"."tags" TO "service_role";



GRANT ALL ON TABLE "public"."v_conversations_with_unread" TO "anon";
GRANT ALL ON TABLE "public"."v_conversations_with_unread" TO "authenticated";
GRANT ALL ON TABLE "public"."v_conversations_with_unread" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_numbers" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_numbers" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_numbers" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







