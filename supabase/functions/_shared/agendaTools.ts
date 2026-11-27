// Agenda na etapa de IA do bot: as ferramentas que a IA usa para consultar
// horários livres, marcar, confirmar e desmarcar, e o trecho das instruções
// com serviços e profissionais.
//
// Sem dependência de Deno (testado no Vitest). Quem chama passa o cliente do
// Supabase (service role): a IA só mexe nos horários do cliente da conversa.

export const AGENDA_TOOL_SLOTS = "agenda_horarios_livres";
export const AGENDA_TOOL_BOOK = "agenda_marcar";
export const AGENDA_TOOL_LIST = "agenda_horarios_do_cliente";
export const AGENDA_TOOL_CANCEL = "agenda_desmarcar";
export const AGENDA_TOOL_CONFIRM = "agenda_confirmar";

export const AGENDA_TOOL_NAMES = new Set([
  AGENDA_TOOL_SLOTS,
  AGENDA_TOOL_BOOK,
  AGENDA_TOOL_LIST,
  AGENDA_TOOL_CANCEL,
  AGENDA_TOOL_CONFIRM,
]);

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";
// O cliente não acumula horários pela IA
export const MAX_ACTIVE_PER_CONTACT = 3;
// Horários livres devolvidos por consulta (a IA oferece alguns)
const MAX_SLOTS_RETURNED = 24;

const ID = { type: "string", description: "Id interno (nunca mostre ao cliente)." };

export const AGENDA_TOOLS = [
  {
    name: AGENDA_TOOL_SLOTS,
    description:
      "Consulta os horários livres de um serviço a partir de um dia. Use sempre antes de oferecer horários: nunca invente horário.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        servico_id: ID,
        profissional_id: {
          type: ["string", "null"],
          description: "Id do profissional, ou null para qualquer um que faça o serviço.",
        },
        data_inicial: { type: "string", description: "Primeiro dia da busca, no formato AAAA-MM-DD." },
        dias: { type: "integer", description: "Quantos dias olhar a partir da data inicial (1 a 7)." },
      },
      required: ["servico_id", "profissional_id", "data_inicial", "dias"],
      additionalProperties: false,
    },
  },
  {
    name: AGENDA_TOOL_BOOK,
    description:
      "Marca um horário para o cliente desta conversa. Só use depois que o cliente confirmou serviço, profissional, dia e hora de um horário livre.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        servico_id: ID,
        profissional_id: ID,
        inicio: {
          type: "string",
          description: "Início exatamente como veio em agenda_horarios_livres (AAAA-MM-DDTHH:MM).",
        },
        observacao: {
          type: ["string", "null"],
          description: "Algo que a equipe precisa saber (ex.: primeira vez, convênio), ou null.",
        },
      },
      required: ["servico_id", "profissional_id", "inicio", "observacao"],
      additionalProperties: false,
    },
  },
  {
    name: AGENDA_TOOL_LIST,
    description: "Lista os próximos horários marcados do cliente desta conversa.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: AGENDA_TOOL_CANCEL,
    description:
      "Desmarca um horário do cliente desta conversa. Use quando o cliente pedir para cancelar, ou ao remarcar (depois de marcar o novo).",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        agendamento_id: ID,
        motivo: { type: ["string", "null"], description: "Motivo em poucas palavras, ou null." },
      },
      required: ["agendamento_id", "motivo"],
      additionalProperties: false,
    },
  },
  {
    name: AGENDA_TOOL_CONFIRM,
    description: "Marca como confirmado um horário do cliente desta conversa, quando ele confirmar presença.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { agendamento_id: ID },
      required: ["agendamento_id"],
      additionalProperties: false,
    },
  },
];

/* ------------------------------- Datas ----------------------------------- */

const WEEKDAYS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

/** Partes da data no fuso informado. */
export const localParts = (date: Date, timeZone: string): LocalParts => {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday,
  };
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-28T14:30" no fuso informado. */
export const toLocalIso = (date: Date, timeZone: string) => {
  const p = localParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
};

/** "sexta-feira, 28/11 às 14:30" no fuso informado. */
export const formatSlotLabel = (date: Date, timeZone: string) => {
  const p = localParts(date, timeZone);
  return `${WEEKDAYS[p.weekday]}, ${pad(p.day)}/${pad(p.month)} às ${pad(p.hour)}:${pad(p.minute)}`;
};

const LOCAL_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Data válida no formato AAAA-MM-DD, ou null. */
export const parseLocalDate = (value: unknown) => {
  const m = LOCAL_DATE.exec(String(value ?? "").trim());
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (date.getUTCMonth() !== Number(m[2]) - 1) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
};

/** "AAAA-MM-DDTHH:MM" no fuso da empresa para o instante real, ou null. */
export const localIsoToDate = (value: unknown, timeZone: string): Date | null => {
  const m = LOCAL_ISO.exec(String(value ?? "").trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  // Chute em UTC e corrige pela diferença do fuso (duas vezes cobre a troca
  // de horário de verão)
  const wanted = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wanted - seen;
  }
  const result = new Date(guess);
  return toLocalIso(result, timeZone) === m[0] ? result : null;
};

/* --------------------------- Instruções da IA ---------------------------- */

export type AgendaService = {
  id: string;
  name: string;
  description?: string | null;
  duration_minutes: number;
  price?: number | string | null;
};

export type AgendaProfessional = {
  id: string;
  name: string;
  specialty?: string | null;
  service_ids: string[];
};

const formatPrice = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

/** Trecho "## Agenda" das instruções, com o que existe para marcar hoje. */
export const buildAgendaPrompt = (params: {
  now: Date;
  timeZone: string;
  services: AgendaService[];
  professionals: AgendaProfessional[];
}) => {
  const { now, timeZone, services, professionals } = params;
  const p = localParts(now, timeZone);
  const today = `${WEEKDAYS[p.weekday]}, ${pad(p.day)}/${pad(p.month)}/${p.year}, ${pad(p.hour)}:${pad(p.minute)}`;

  const serviceLines = services.map((s) => {
    const price = formatPrice(s.price);
    const doers = professionals.filter((pr) => pr.service_ids.includes(s.id)).map((pr) => pr.name);
    const extra = [
      `${s.duration_minutes} min`,
      price ? `preço ${price}` : null,
      doers.length > 0 ? `com ${doers.join(", ")}` : "sem profissional disponível",
    ]
      .filter(Boolean)
      .join("; ");
    const description = String(s.description ?? "").trim();
    return `- ${s.name} (id ${s.id}; ${extra})${description ? `: ${description}` : ""}`;
  });

  const professionalLines = professionals.map((pr) => {
    const specialty = String(pr.specialty ?? "").trim();
    return `- ${pr.name}${specialty ? `, ${specialty}` : ""} (id ${pr.id})`;
  });

  return [
    "## Agenda",
    `Você pode marcar, remarcar, confirmar e desmarcar horários do cliente desta conversa. Agora é ${today} (no fuso da empresa).`,
    "Serviços:",
    serviceLines.length > 0 ? serviceLines.join("\n") : "- (nenhum serviço cadastrado)",
    "Profissionais:",
    professionalLines.length > 0 ? professionalLines.join("\n") : "- (nenhum profissional cadastrado)",
    `Como agendar:
- Descubra o serviço e, se o cliente tiver preferência, o profissional e o dia. Depois consulte ${AGENDA_TOOL_SLOTS} e ofereça poucas opções (duas ou três), com dia da semana, data e hora.
- Só marque (${AGENDA_TOOL_BOOK}) depois que o cliente escolher um horário que veio da consulta. Use o início exatamente como veio.
- Depois de marcar, confirme para o cliente: serviço, profissional, dia e hora.
- Para remarcar: marque o horário novo e depois desmarque o antigo (${AGENDA_TOOL_CANCEL}). Para ver o que já está marcado, use ${AGENDA_TOOL_LIST}.
- Se o cliente confirmar presença em um horário marcado, use ${AGENDA_TOOL_CONFIRM}.
- Nunca mostre ids ao cliente. Se não houver horário que sirva, ou o serviço não estiver na lista, transfira para a equipe.`,
  ].join("\n");
};

/* ------------------------------ Execução --------------------------------- */

export type AgendaContext = {
  supabase: any;
  clinicId: string;
  conversationId: string;
  contactId: string | null;
  timeZone: string;
  now?: () => Date;
};

export type AgendaToolOutcome = {
  /** Texto devolvido para a IA */
  result: string;
  isError?: boolean;
  /** Algo mudou na agenda: aviso na conversa para a equipe */
  event?: { type: "appointment_booked" | "appointment_cancelled" | "appointment_confirmed"; metadata: Record<string, unknown> };
};

const fail = (result: string): AgendaToolOutcome => ({ result, isError: true });

const isUuid = (value: unknown) =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const loadNames = async (ctx: AgendaContext, professionalIds: string[], serviceIds: string[]) => {
  const [{ data: pros }, { data: svcs }] = await Promise.all([
    professionalIds.length
      ? ctx.supabase.from("agenda_professionals").select("id, name").eq("clinic_id", ctx.clinicId).in("id", professionalIds)
      : Promise.resolve({ data: [] }),
    serviceIds.length
      ? ctx.supabase.from("agenda_services").select("id, name").eq("clinic_id", ctx.clinicId).in("id", serviceIds)
      : Promise.resolve({ data: [] }),
  ]);
  return {
    professional: new Map<string, string>((pros ?? []).map((r: any) => [r.id, r.name])),
    service: new Map<string, string>((svcs ?? []).map((r: any) => [r.id, r.name])),
  };
};

async function freeSlots(ctx: AgendaContext, input: any): Promise<AgendaToolOutcome> {
  if (!isUuid(input?.servico_id)) return fail("servico_id inválido. Use um id da lista de serviços.");
  if (input?.profissional_id != null && !isUuid(input.profissional_id)) {
    return fail("profissional_id inválido. Use um id da lista de profissionais ou null.");
  }
  const from = parseLocalDate(input?.data_inicial);
  if (!from) return fail("data_inicial inválida. Use AAAA-MM-DD.");
  const days = Math.min(7, Math.max(1, Math.round(Number(input?.dias) || 1)));

  const { data, error } = await ctx.supabase.rpc("agenda_free_slots", {
    p_clinic_id: ctx.clinicId,
    p_service_id: input.servico_id,
    p_professional_id: input.profissional_id ?? null,
    p_from: from,
    p_days: days,
    p_limit: 300,
  });
  if (error) {
    console.error("agenda_free_slots error:", error);
    return fail("Não foi possível consultar a agenda agora.");
  }
  const rows: any[] = data ?? [];
  if (rows.length === 0) {
    return { result: `Nenhum horário livre para este serviço entre ${from} e os ${days} dias seguintes.` };
  }

  // Espalha as opções pelos dias em vez de devolver só a primeira manhã
  const byDay = new Map<string, any[]>();
  for (const row of rows) {
    const key = toLocalIso(new Date(row.starts_at), ctx.timeZone).slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(row);
  }
  const perDay = Math.max(4, Math.floor(MAX_SLOTS_RETURNED / byDay.size));
  const picked = Array.from(byDay.values()).flatMap((list) => list.slice(0, perDay)).slice(0, MAX_SLOTS_RETURNED);

  const names = await loadNames(ctx, Array.from(new Set(picked.map((r) => r.professional_id))), []);
  const lines = picked.map((row) => {
    const start = new Date(row.starts_at);
    const who = names.professional.get(row.professional_id) ?? "profissional";
    return `- inicio ${toLocalIso(start, ctx.timeZone)} (${formatSlotLabel(start, ctx.timeZone)}) com ${who} [profissional_id ${row.professional_id}]`;
  });
  const more = rows.length > picked.length ? `\nHá mais horários nesses dias; peça outro período se precisar.` : "";
  return { result: `Horários livres:\n${lines.join("\n")}${more}` };
}

async function book(ctx: AgendaContext, input: any): Promise<AgendaToolOutcome> {
  if (!ctx.contactId) return fail("Esta conversa não tem cliente cadastrado. Transfira para a equipe.");
  if (!isUuid(input?.servico_id) || !isUuid(input?.profissional_id)) {
    return fail("servico_id ou profissional_id inválido.");
  }
  const start = localIsoToDate(input?.inicio, ctx.timeZone);
  if (!start) return fail("inicio inválido. Use exatamente o início que veio em agenda_horarios_livres.");

  const { count } = await ctx.supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", ctx.clinicId)
    .eq("contact_id", ctx.contactId)
    .in("status", ["scheduled", "confirmed"])
    .gt("starts_at", (ctx.now?.() ?? new Date()).toISOString());
  if ((count ?? 0) >= MAX_ACTIVE_PER_CONTACT) {
    return fail(
      `O cliente já tem ${count} horários marcados. Para marcar outro, desmarque um deles ou transfira para a equipe.`,
    );
  }

  // O horário precisa estar livre de verdade (expediente, folga, antecedência)
  const day = toLocalIso(start, ctx.timeZone).slice(0, 10);
  const { data: slots, error: slotsErr } = await ctx.supabase.rpc("agenda_free_slots", {
    p_clinic_id: ctx.clinicId,
    p_service_id: input.servico_id,
    p_professional_id: input.profissional_id,
    p_from: day,
    p_days: 1,
    p_limit: 500,
  });
  if (slotsErr) {
    console.error("agenda_free_slots error:", slotsErr);
    return fail("Não foi possível consultar a agenda agora.");
  }
  const slot = (slots ?? []).find((s: any) => new Date(s.starts_at).getTime() === start.getTime());
  if (!slot) {
    return fail("Este horário não está mais livre. Consulte agenda_horarios_livres de novo e ofereça outras opções.");
  }

  const observacao = typeof input?.observacao === "string" ? input.observacao.trim().slice(0, 1000) : "";
  const { data: created, error } = await ctx.supabase
    .from("appointments")
    .insert({
      clinic_id: ctx.clinicId,
      professional_id: input.profissional_id,
      service_id: input.servico_id,
      contact_id: ctx.contactId,
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
      status: "scheduled",
      source: "ai",
      conversation_id: ctx.conversationId,
      notes: observacao || null,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("appointments insert error:", error);
    const busy = String(error?.message ?? "").includes("ocupado");
    return fail(
      busy
        ? "Este horário acabou de ser ocupado. Consulte agenda_horarios_livres de novo."
        : "Não foi possível marcar agora. Transfira para a equipe.",
    );
  }

  const names = await loadNames(ctx, [input.profissional_id], [input.servico_id]);
  const professionalName = names.professional.get(input.profissional_id) ?? "";
  const serviceName = names.service.get(input.servico_id) ?? "";
  const label = formatSlotLabel(new Date(slot.starts_at), ctx.timeZone);
  return {
    result: `Marcado: ${serviceName} com ${professionalName}, ${label}. agendamento_id ${created.id}.`,
    event: {
      type: "appointment_booked",
      metadata: {
        appointment_id: created.id,
        starts_at: slot.starts_at,
        professional_name: professionalName,
        service_name: serviceName,
        by: "ai",
      },
    },
  };
}

async function listForContact(ctx: AgendaContext): Promise<AgendaToolOutcome> {
  if (!ctx.contactId) return { result: "Esta conversa não tem cliente cadastrado." };
  const { data, error } = await ctx.supabase
    .from("appointments")
    .select("id, starts_at, status, professional_id, service_id")
    .eq("clinic_id", ctx.clinicId)
    .eq("contact_id", ctx.contactId)
    .in("status", ["scheduled", "confirmed"])
    .gt("starts_at", (ctx.now?.() ?? new Date()).toISOString())
    .order("starts_at", { ascending: true })
    .limit(10);
  if (error) {
    console.error("appointments list error:", error);
    return fail("Não foi possível consultar a agenda agora.");
  }
  const rows: any[] = data ?? [];
  if (rows.length === 0) return { result: "O cliente não tem horários marcados." };
  const names = await loadNames(
    ctx,
    Array.from(new Set(rows.map((r) => r.professional_id))),
    Array.from(new Set(rows.map((r) => r.service_id).filter(Boolean))),
  );
  const lines = rows.map((r) => {
    const label = formatSlotLabel(new Date(r.starts_at), ctx.timeZone);
    const service = names.service.get(r.service_id) ?? "atendimento";
    const who = names.professional.get(r.professional_id) ?? "profissional";
    const status = r.status === "confirmed" ? "confirmado" : "marcado";
    return `- ${service} com ${who}, ${label} (${status}) [agendamento_id ${r.id}]`;
  });
  return { result: `Horários do cliente:\n${lines.join("\n")}` };
}

/** Agendamento futuro e ativo do cliente da conversa, ou null. */
async function ownAppointment(ctx: AgendaContext, id: unknown) {
  if (!ctx.contactId || !isUuid(id)) return null;
  const { data } = await ctx.supabase
    .from("appointments")
    .select("id, starts_at, status, professional_id, service_id")
    .eq("id", id)
    .eq("clinic_id", ctx.clinicId)
    .eq("contact_id", ctx.contactId)
    .in("status", ["scheduled", "confirmed"])
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.starts_at).getTime() <= (ctx.now?.() ?? new Date()).getTime()) return null;
  return data;
}

async function changeStatus(
  ctx: AgendaContext,
  input: any,
  status: "cancelled" | "confirmed",
): Promise<AgendaToolOutcome> {
  const appt = await ownAppointment(ctx, input?.agendamento_id);
  if (!appt) {
    return fail(`Agendamento não encontrado entre os próximos horários do cliente. Use ${AGENDA_TOOL_LIST}.`);
  }
  const patch: Record<string, unknown> = { status };
  if (status === "cancelled") {
    const motivo = typeof input?.motivo === "string" ? input.motivo.trim().slice(0, 300) : "";
    patch.cancel_reason = motivo || "Desmarcado pelo cliente no WhatsApp";
  }
  const { error } = await ctx.supabase.from("appointments").update(patch).eq("id", appt.id);
  if (error) {
    console.error("appointments update error:", error);
    return fail("Não foi possível alterar o horário agora. Transfira para a equipe.");
  }
  const names = await loadNames(ctx, [appt.professional_id], appt.service_id ? [appt.service_id] : []);
  const professionalName = names.professional.get(appt.professional_id) ?? "";
  const serviceName = names.service.get(appt.service_id) ?? "";
  const label = formatSlotLabel(new Date(appt.starts_at), ctx.timeZone);
  return {
    result: `${status === "cancelled" ? "Desmarcado" : "Confirmado"}: ${serviceName || "atendimento"} com ${professionalName}, ${label}.`,
    event: {
      type: status === "cancelled" ? "appointment_cancelled" : "appointment_confirmed",
      metadata: {
        appointment_id: appt.id,
        starts_at: appt.starts_at,
        professional_name: professionalName,
        service_name: serviceName,
        by: "ai",
      },
    },
  };
}

/** Executa uma ferramenta da agenda. Nunca lança: erro vira texto para a IA. */
export async function runAgendaTool(ctx: AgendaContext, name: string, input: unknown): Promise<AgendaToolOutcome> {
  try {
    switch (name) {
      case AGENDA_TOOL_SLOTS:
        return await freeSlots(ctx, input);
      case AGENDA_TOOL_BOOK:
        return await book(ctx, input);
      case AGENDA_TOOL_LIST:
        return await listForContact(ctx);
      case AGENDA_TOOL_CANCEL:
        return await changeStatus(ctx, input, "cancelled");
      case AGENDA_TOOL_CONFIRM:
        return await changeStatus(ctx, input, "confirmed");
      default:
        return fail("Ferramenta desconhecida.");
    }
  } catch (err) {
    console.error("runAgendaTool error:", name, err);
    return fail("Não foi possível usar a agenda agora. Transfira para a equipe.");
  }
}

/** Serviços ativos com profissional e os profissionais ativos, para as instruções. */
export async function loadAgendaCatalog(supabase: any, clinicId: string) {
  const [{ data: services }, { data: professionals }, { data: links }, { data: settings }] = await Promise.all([
    supabase
      .from("agenda_services")
      .select("id, name, description, duration_minutes, price")
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .order("position", { ascending: true }),
    supabase
      .from("agenda_professionals")
      .select("id, name, specialty")
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .order("position", { ascending: true }),
    supabase.from("agenda_professional_services").select("professional_id, service_id").eq("clinic_id", clinicId),
    supabase.from("agenda_settings").select("timezone").eq("clinic_id", clinicId).maybeSingle(),
  ]);
  const byProfessional = new Map<string, string[]>();
  for (const link of links ?? []) {
    if (!byProfessional.has(link.professional_id)) byProfessional.set(link.professional_id, []);
    byProfessional.get(link.professional_id)!.push(link.service_id);
  }
  return {
    timeZone: String(settings?.timezone ?? "") || DEFAULT_TIMEZONE,
    services: (services ?? []) as AgendaService[],
    professionals: (professionals ?? []).map((p: any) => ({
      ...p,
      service_ids: byProfessional.get(p.id) ?? [],
    })) as AgendaProfessional[],
  };
}
