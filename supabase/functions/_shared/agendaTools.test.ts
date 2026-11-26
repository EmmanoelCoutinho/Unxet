import { describe, expect, it } from "vitest";
import {
  AGENDA_TOOLS,
  AGENDA_TOOL_BOOK,
  AGENDA_TOOL_CANCEL,
  AGENDA_TOOL_SLOTS,
  buildAgendaPrompt,
  formatSlotLabel,
  localIsoToDate,
  parseLocalDate,
  runAgendaTool,
  toLocalIso,
} from "./agendaTools";

const TZ = "America/Sao_Paulo";
const CLINIC = "00000000-0000-4000-8000-000000000001";
const PRO = "00000000-0000-4000-8000-0000000000a1";
const SVC = "00000000-0000-4000-8000-0000000000b1";
const CONTACT = "00000000-0000-4000-8000-0000000000c1";
const APPT = "00000000-0000-4000-8000-0000000000d1";

/**
 * Supabase de mentira: cada tabela devolve as linhas configuradas e guarda o
 * que foi inserido/alterado. Os filtros são ignorados (os testes montam só as
 * linhas que importam).
 */
const fakeSupabase = (config: {
  slots?: { professional_id: string; starts_at: string; ends_at: string }[];
  activeCount?: number;
  appointments?: any[];
  insertError?: { message: string } | null;
}) => {
  const inserted: any[] = [];
  const updated: any[] = [];
  const rpcCalls: any[] = [];
  const names: Record<string, any[]> = {
    agenda_professionals: [{ id: PRO, name: "Dra. Ana" }],
    agenda_services: [{ id: SVC, name: "Consulta" }],
  };
  const builder = (table: string) => {
    let mode: "select" | "insert" | "update" = "select";
    let head = false;
    let payload: any = null;
    const chain: any = {
      select: (_cols?: string, opts?: { head?: boolean }) => {
        head = Boolean(opts?.head);
        return chain;
      },
      insert: (row: any) => {
        mode = "insert";
        payload = row;
        return chain;
      },
      update: (row: any) => {
        mode = "update";
        payload = row;
        return chain;
      },
      eq: () => chain,
      in: () => chain,
      gt: () => chain,
      order: () => chain,
      limit: () => chain,
      single: async () => {
        if (mode === "insert") {
          if (config.insertError) return { data: null, error: config.insertError };
          inserted.push({ table, ...payload });
          return { data: { id: APPT }, error: null };
        }
        return { data: null, error: null };
      },
      maybeSingle: async () => ({ data: (config.appointments ?? [])[0] ?? null, error: null }),
      then: (resolve: (v: any) => void) => {
        if (mode === "update") {
          updated.push({ table, ...payload });
          return resolve({ error: null });
        }
        if (head) return resolve({ count: config.activeCount ?? 0, error: null });
        if (table in names) return resolve({ data: names[table], error: null });
        return resolve({ data: config.appointments ?? [], error: null });
      },
    };
    return chain;
  };
  return {
    client: {
      from: builder,
      rpc: async (name: string, args: any) => {
        rpcCalls.push({ name, args });
        return { data: config.slots ?? [], error: null };
      },
    },
    inserted,
    updated,
    rpcCalls,
  };
};

const ctx = (supabase: any) => ({
  supabase,
  clinicId: CLINIC,
  conversationId: "conv-1",
  contactId: CONTACT,
  timeZone: TZ,
  now: () => new Date("2026-11-26T12:00:00Z"),
});

describe("datas no fuso da empresa", () => {
  it("converte o horário local para o instante e volta", () => {
    const date = localIsoToDate("2026-11-28T14:30", TZ);
    expect(date?.toISOString()).toBe("2026-11-28T17:30:00.000Z");
    expect(toLocalIso(date!, TZ)).toBe("2026-11-28T14:30");
    expect(formatSlotLabel(date!, TZ)).toBe("sábado, 28/11 às 14:30");
  });

  it("recusa formato ou data que não existe", () => {
    expect(localIsoToDate("28/11/2026 14:30", TZ)).toBeNull();
    expect(localIsoToDate("2026-02-30T10:00", TZ)).toBeNull();
    expect(parseLocalDate("2026-11-31")).toBeNull();
    expect(parseLocalDate("2026-12-01")).toBe("2026-12-01");
  });

  it("acerta fuso com horário de verão (Nova York)", () => {
    expect(localIsoToDate("2026-07-01T09:00", "America/New_York")?.toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(localIsoToDate("2026-12-01T09:00", "America/New_York")?.toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });
});

describe("ferramentas", () => {
  it("todas no formato estrito, com todos os campos obrigatórios", () => {
    for (const tool of AGENDA_TOOLS) {
      expect(tool.strict).toBe(true);
      expect(tool.input_schema.additionalProperties).toBe(false);
      expect([...tool.input_schema.required].sort()).toEqual(Object.keys(tool.input_schema.properties).sort());
    }
  });

  it("instruções trazem serviços, profissionais e a data de hoje", () => {
    const prompt = buildAgendaPrompt({
      now: new Date("2026-11-26T12:00:00Z"),
      timeZone: TZ,
      services: [{ id: SVC, name: "Consulta", duration_minutes: 30, price: "150.00", description: "Primeira vez" }],
      professionals: [{ id: PRO, name: "Dra. Ana", specialty: "Dermatologista", service_ids: [SVC] }],
    });
    expect(prompt).toContain("quinta-feira, 26/11/2026, 09:00");
    expect(prompt).toContain(`- Consulta (id ${SVC}; 30 min; preço R$`);
    expect(prompt).toContain("com Dra. Ana): Primeira vez");
    expect(prompt).toContain(`- Dra. Ana, Dermatologista (id ${PRO})`);
  });
});

describe("runAgendaTool", () => {
  const slot = { professional_id: PRO, starts_at: "2026-11-28T17:30:00+00:00", ends_at: "2026-11-28T18:00:00+00:00" };

  it("horários livres saem no horário local, com o profissional", async () => {
    const fake = fakeSupabase({ slots: [slot] });
    const out = await runAgendaTool(ctx(fake.client), AGENDA_TOOL_SLOTS, {
      servico_id: SVC,
      profissional_id: null,
      data_inicial: "2026-11-28",
      dias: 30,
    });
    expect(out.isError).toBeFalsy();
    expect(out.result).toContain("inicio 2026-11-28T14:30 (sábado, 28/11 às 14:30) com Dra. Ana");
    // No máximo 7 dias por consulta
    expect(fake.rpcCalls[0].args).toMatchObject({ p_from: "2026-11-28", p_days: 7, p_professional_id: null });
  });

  it("marca só horário que está livre, para o cliente da conversa", async () => {
    const fake = fakeSupabase({ slots: [slot] });
    const out = await runAgendaTool(ctx(fake.client), AGENDA_TOOL_BOOK, {
      servico_id: SVC,
      profissional_id: PRO,
      inicio: "2026-11-28T14:30",
      observacao: "primeira vez",
    });
    expect(out.isError).toBeFalsy();
    expect(out.result).toContain("Marcado: Consulta com Dra. Ana, sábado, 28/11 às 14:30");
    expect(fake.inserted[0]).toMatchObject({
      table: "appointments",
      contact_id: CONTACT,
      source: "ai",
      conversation_id: "conv-1",
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
      notes: "primeira vez",
    });
    expect(out.event?.type).toBe("appointment_booked");
  });

  it("não marca horário que não veio da consulta", async () => {
    const fake = fakeSupabase({ slots: [slot] });
    const out = await runAgendaTool(ctx(fake.client), AGENDA_TOOL_BOOK, {
      servico_id: SVC,
      profissional_id: PRO,
      inicio: "2026-11-28T15:00",
      observacao: null,
    });
    expect(out.isError).toBe(true);
    expect(fake.inserted).toHaveLength(0);
  });

  it("não deixa o cliente acumular horários", async () => {
    const fake = fakeSupabase({ slots: [slot], activeCount: 3 });
    const out = await runAgendaTool(ctx(fake.client), AGENDA_TOOL_BOOK, {
      servico_id: SVC,
      profissional_id: PRO,
      inicio: "2026-11-28T14:30",
      observacao: null,
    });
    expect(out.isError).toBe(true);
    expect(out.result).toContain("já tem 3 horários");
  });

  it("sem cliente na conversa, não marca", async () => {
    const fake = fakeSupabase({ slots: [slot] });
    const out = await runAgendaTool({ ...ctx(fake.client), contactId: null }, AGENDA_TOOL_BOOK, {
      servico_id: SVC,
      profissional_id: PRO,
      inicio: "2026-11-28T14:30",
      observacao: null,
    });
    expect(out.isError).toBe(true);
  });

  it("desmarca só horário futuro do próprio cliente", async () => {
    const future = { id: APPT, starts_at: "2026-11-28T17:30:00+00:00", status: "scheduled", professional_id: PRO, service_id: SVC };
    const fake = fakeSupabase({ appointments: [future] });
    const out = await runAgendaTool(ctx(fake.client), AGENDA_TOOL_CANCEL, { agendamento_id: APPT, motivo: null });
    expect(out.isError).toBeFalsy();
    expect(fake.updated[0]).toMatchObject({ status: "cancelled", cancel_reason: "Desmarcado pelo cliente no WhatsApp" });

    const past = { ...future, starts_at: "2026-11-20T17:30:00+00:00" };
    const fakePast = fakeSupabase({ appointments: [past] });
    const outPast = await runAgendaTool(ctx(fakePast.client), AGENDA_TOOL_CANCEL, { agendamento_id: APPT, motivo: null });
    expect(outPast.isError).toBe(true);
    expect(fakePast.updated).toHaveLength(0);
  });

  it("id inválido não chega no banco", async () => {
    const fake = fakeSupabase({});
    const out = await runAgendaTool(ctx(fake.client), AGENDA_TOOL_SLOTS, {
      servico_id: "consulta",
      profissional_id: null,
      data_inicial: "2026-11-28",
      dias: 1,
    });
    expect(out.isError).toBe(true);
    expect(fake.rpcCalls).toHaveLength(0);
  });
});
