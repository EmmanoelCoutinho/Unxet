import { supabase } from "../../../lib/supabaseClient";
import type {
  AgendaService,
  AgendaServiceInput,
  AgendaSettings,
  Appointment,
  AppointmentInput,
  AppointmentStatus,
  FreeSlot,
  Professional,
  ProfessionalInput,
  TimeOff,
  WorkingHour,
} from "../types";

// numeric chega como texto pelo PostgREST
const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// "08:00:00" -> "08:00"
const shortTime = (value: string) => String(value ?? "").slice(0, 5);

/** Mensagem do banco (trigger) em português, ou a mensagem padrão. */
export const agendaErrorMessage = (err: unknown, fallback: string) => {
  const message = (err as { message?: string } | null)?.message ?? "";
  // Mensagens das regras da agenda já vêm prontas para mostrar
  if (/ocupado|não encontrad|inválido/i.test(message)) return message;
  if (/row-level security|permission denied/i.test(message)) {
    return "Você não tem permissão para fazer isso na Agenda.";
  }
  return fallback;
};

/* ------------------------------ Profissionais ----------------------------- */

export const listProfessionals = async (clinicId: string | null): Promise<Professional[]> => {
  if (!clinicId) return [];
  const [{ data: rows, error }, { data: links, error: linksErr }, { data: hours, error: hoursErr }] =
    await Promise.all([
      supabase
        .from("agenda_professionals")
        .select("id, name, specialty, color, user_id, active, position")
        .eq("clinic_id", clinicId)
        .order("position", { ascending: true })
        .order("name", { ascending: true }),
      supabase.from("agenda_professional_services").select("professional_id, service_id").eq("clinic_id", clinicId),
      supabase
        .from("agenda_working_hours")
        .select("id, professional_id, weekday, start_time, end_time")
        .eq("clinic_id", clinicId)
        .order("weekday", { ascending: true })
        .order("start_time", { ascending: true }),
    ]);
  if (error) throw error;
  if (linksErr) throw linksErr;
  if (hoursErr) throw hoursErr;

  return (rows ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    specialty: row.specialty,
    color: row.color,
    userId: row.user_id,
    active: row.active,
    position: row.position,
    serviceIds: (links ?? []).filter((l: any) => l.professional_id === row.id).map((l: any) => l.service_id),
    hours: (hours ?? [])
      .filter((h: any) => h.professional_id === row.id)
      .map((h: any) => ({ id: h.id, weekday: h.weekday, start: shortTime(h.start_time), end: shortTime(h.end_time) })),
  }));
};

const replaceHours = async (clinicId: string, professionalId: string, hours: WorkingHour[]) => {
  const { error: delErr } = await supabase.from("agenda_working_hours").delete().eq("professional_id", professionalId);
  if (delErr) throw delErr;
  if (hours.length === 0) return;
  const { error } = await supabase.from("agenda_working_hours").insert(
    hours.map((h) => ({
      clinic_id: clinicId,
      professional_id: professionalId,
      weekday: h.weekday,
      start_time: h.start,
      end_time: h.end,
    })),
  );
  if (error) throw error;
};

const replaceProfessionalServices = async (clinicId: string, professionalId: string, serviceIds: string[]) => {
  const { error: delErr } = await supabase
    .from("agenda_professional_services")
    .delete()
    .eq("professional_id", professionalId);
  if (delErr) throw delErr;
  if (serviceIds.length === 0) return;
  const { error } = await supabase
    .from("agenda_professional_services")
    .insert(serviceIds.map((serviceId) => ({ clinic_id: clinicId, professional_id: professionalId, service_id: serviceId })));
  if (error) throw error;
};

export const saveProfessional = async (
  clinicId: string,
  id: string | null,
  input: ProfessionalInput,
  position: number,
) => {
  const columns = {
    name: input.name.trim(),
    specialty: input.specialty?.trim() || null,
    color: input.color,
    user_id: input.userId,
    active: input.active,
  };
  let professionalId = id;
  if (id) {
    const { error } = await supabase.from("agenda_professionals").update(columns).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from("agenda_professionals")
      .insert({ ...columns, clinic_id: clinicId, position })
      .select("id")
      .single();
    if (error) throw error;
    professionalId = data.id;
  }
  await replaceHours(clinicId, professionalId!, input.hours);
  await replaceProfessionalServices(clinicId, professionalId!, input.serviceIds);
  return professionalId!;
};

/** Apaga se nunca teve agendamento; senão só desativa. Devolve o que fez. */
export const removeProfessional = async (id: string): Promise<"deleted" | "deactivated"> => {
  const { count, error: countErr } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("professional_id", id);
  if (countErr) throw countErr;
  if ((count ?? 0) > 0) {
    const { error } = await supabase.from("agenda_professionals").update({ active: false }).eq("id", id);
    if (error) throw error;
    return "deactivated";
  }
  const { error } = await supabase.from("agenda_professionals").delete().eq("id", id);
  if (error) throw error;
  return "deleted";
};

/* -------------------------------- Serviços -------------------------------- */

export const listServices = async (clinicId: string | null): Promise<AgendaService[]> => {
  if (!clinicId) return [];
  const { data, error } = await supabase
    .from("agenda_services")
    .select("id, name, description, duration_minutes, price, active, position")
    .eq("clinic_id", clinicId)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    durationMinutes: row.duration_minutes,
    price: toNumber(row.price),
    active: row.active,
    position: row.position,
  }));
};

export const saveService = async (clinicId: string, id: string | null, input: AgendaServiceInput, position: number) => {
  const columns = {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    duration_minutes: input.durationMinutes,
    price: input.price,
    active: input.active,
  };
  let serviceId = id;
  if (id) {
    const { error } = await supabase.from("agenda_services").update(columns).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from("agenda_services")
      .insert({ ...columns, clinic_id: clinicId, position })
      .select("id")
      .single();
    if (error) throw error;
    serviceId = data.id;
  }
  // Quem faz o serviço
  const { error: delErr } = await supabase.from("agenda_professional_services").delete().eq("service_id", serviceId!);
  if (delErr) throw delErr;
  if (input.professionalIds.length > 0) {
    const { error } = await supabase.from("agenda_professional_services").insert(
      input.professionalIds.map((professionalId) => ({
        clinic_id: clinicId,
        professional_id: professionalId,
        service_id: serviceId!,
      })),
    );
    if (error) throw error;
  }
  return serviceId!;
};

/** Apaga o serviço (agendamentos antigos ficam, sem o nome do serviço). */
export const deleteService = async (id: string) => {
  const { count } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("service_id", id);
  if ((count ?? 0) > 0) {
    const { error } = await supabase.from("agenda_services").update({ active: false }).eq("id", id);
    if (error) throw error;
    return "deactivated" as const;
  }
  const { error } = await supabase.from("agenda_services").delete().eq("id", id);
  if (error) throw error;
  return "deleted" as const;
};

/* --------------------------------- Folgas --------------------------------- */

export const listTimeOff = async (clinicId: string | null, from: Date, to: Date): Promise<TimeOff[]> => {
  if (!clinicId) return [];
  const { data, error } = await supabase
    .from("agenda_time_off")
    .select("id, professional_id, starts_at, ends_at, reason")
    .eq("clinic_id", clinicId)
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString())
    .order("starts_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    professionalId: row.professional_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: row.reason,
  }));
};

export const createTimeOff = async (
  clinicId: string,
  input: { professionalId: string; startsAt: string; endsAt: string; reason: string | null },
) => {
  const { error } = await supabase.from("agenda_time_off").insert({
    clinic_id: clinicId,
    professional_id: input.professionalId,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    reason: input.reason?.trim() || null,
  });
  if (error) throw error;
};

export const deleteTimeOff = async (id: string) => {
  const { error } = await supabase.from("agenda_time_off").delete().eq("id", id);
  if (error) throw error;
};

/* ------------------------------ Agendamentos ------------------------------ */

const APPOINTMENT_COLUMNS =
  "id, professional_id, service_id, contact_id, starts_at, ends_at, status, notes, source, conversation_id, cancel_reason, created_by, created_at, contact:contacts(name, phone)";

const mapAppointment = (row: any): Appointment => ({
  id: row.id,
  professionalId: row.professional_id,
  serviceId: row.service_id,
  contactId: row.contact_id,
  contactName: row.contact?.name ?? null,
  contactPhone: row.contact?.phone ?? null,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  status: row.status,
  notes: row.notes,
  source: row.source,
  conversationId: row.conversation_id,
  cancelReason: row.cancel_reason,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

export const listAppointments = async (clinicId: string | null, from: Date, to: Date): Promise<Appointment[]> => {
  if (!clinicId) return [];
  const { data, error } = await supabase
    .from("appointments")
    .select(APPOINTMENT_COLUMNS)
    .eq("clinic_id", clinicId)
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString())
    .order("starts_at", { ascending: true })
    .limit(2000);
  if (error) throw error;
  return (data ?? []).map(mapAppointment);
};

export const listContactAppointments = async (clinicId: string | null, contactId: string | null) => {
  if (!clinicId || !contactId) return [];
  const { data, error } = await supabase
    .from("appointments")
    .select(APPOINTMENT_COLUMNS)
    .eq("clinic_id", clinicId)
    .eq("contact_id", contactId)
    .order("starts_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []).map(mapAppointment);
};

export const createAppointment = async (clinicId: string, input: AppointmentInput) => {
  const { data, error } = await supabase
    .from("appointments")
    .insert({
      clinic_id: clinicId,
      professional_id: input.professionalId,
      service_id: input.serviceId,
      contact_id: input.contactId,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      notes: input.notes?.trim() || null,
      source: "manual",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
};

export const updateAppointment = async (id: string, input: AppointmentInput) => {
  const { error } = await supabase
    .from("appointments")
    .update({
      professional_id: input.professionalId,
      service_id: input.serviceId,
      contact_id: input.contactId,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      notes: input.notes?.trim() || null,
    })
    .eq("id", id);
  if (error) throw error;
};

export const setAppointmentStatus = async (id: string, status: AppointmentStatus, cancelReason?: string | null) => {
  const { error } = await supabase
    .from("appointments")
    .update({
      status,
      ...(status === "cancelled" ? { cancel_reason: cancelReason?.trim() || null } : {}),
    })
    .eq("id", id);
  if (error) throw error;
};

export const listFreeSlots = async (params: {
  clinicId: string;
  serviceId: string;
  professionalId: string | null;
  date: string;
  days?: number;
}): Promise<FreeSlot[]> => {
  const { data, error } = await supabase.rpc("agenda_free_slots", {
    p_clinic_id: params.clinicId,
    p_service_id: params.serviceId,
    p_professional_id: params.professionalId,
    p_from: params.date,
    p_days: params.days ?? 1,
    p_limit: 300,
  });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    professionalId: row.professional_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  }));
};

/* ------------------------------ Configurações ----------------------------- */

export const DEFAULT_REMINDER_MESSAGE =
  "Olá, {nome}! Passando para lembrar do seu horário de {servico} com {profissional} em {data}, às {hora}. Se precisar remarcar, é só responder esta mensagem.";

export const DEFAULT_SETTINGS: AgendaSettings = {
  timezone: "America/Sao_Paulo",
  slotStepMinutes: 30,
  minNoticeMinutes: 60,
  maxDaysAhead: 60,
  reminderEnabled: false,
  reminderHoursBefore: 24,
  reminderConnectionId: null,
  reminderTemplateId: null,
  reminderMessage: DEFAULT_REMINDER_MESSAGE,
};

export const getAgendaSettings = async (clinicId: string | null): Promise<AgendaSettings> => {
  if (!clinicId) return DEFAULT_SETTINGS;
  const { data, error } = await supabase.from("agenda_settings").select("*").eq("clinic_id", clinicId).maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_SETTINGS;
  return {
    timezone: data.timezone,
    slotStepMinutes: data.slot_step_minutes,
    minNoticeMinutes: data.min_notice_minutes,
    maxDaysAhead: data.max_days_ahead,
    reminderEnabled: data.reminder_enabled,
    reminderHoursBefore: data.reminder_hours_before,
    reminderConnectionId: data.reminder_connection_id,
    reminderTemplateId: data.reminder_template_id,
    reminderMessage: data.reminder_message,
  };
};

export const saveAgendaSettings = async (clinicId: string, settings: AgendaSettings) => {
  const { error } = await supabase.from("agenda_settings").upsert(
    {
      clinic_id: clinicId,
      timezone: settings.timezone,
      slot_step_minutes: settings.slotStepMinutes,
      min_notice_minutes: settings.minNoticeMinutes,
      max_days_ahead: settings.maxDaysAhead,
      reminder_enabled: settings.reminderEnabled,
      reminder_hours_before: settings.reminderHoursBefore,
      reminder_connection_id: settings.reminderConnectionId,
      reminder_template_id: settings.reminderTemplateId,
      reminder_message: settings.reminderMessage.trim(),
    },
    { onConflict: "clinic_id" },
  );
  if (error) throw error;
};

/* ------------------------------- Lembretes -------------------------------- */

export type AppointmentReminder = {
  scheduledAt: string;
  status: string;
  recipientStatus: string | null;
  error: string | null;
};

/** Lembrete do agendamento (o mais recente), ou null. */
export const getAppointmentReminder = async (appointmentId: string): Promise<AppointmentReminder | null> => {
  const { data, error } = await supabase
    .from("scheduled_messages")
    .select("scheduled_at, status, recipients:scheduled_message_recipients(status, error)")
    .eq("appointment_id", appointmentId)
    .order("scheduled_at", { ascending: false })
    .limit(1);
  if (error) return null;
  const row: any = data?.[0];
  if (!row) return null;
  const recipient = row.recipients?.[0] ?? null;
  return {
    scheduledAt: row.scheduled_at,
    status: row.status,
    recipientStatus: recipient?.status ?? null,
    error: recipient?.error ?? null,
  };
};
