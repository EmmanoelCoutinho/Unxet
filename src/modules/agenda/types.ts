// Agenda: profissionais, serviços, horários e agendamentos
// (migration 20261207000000_agenda.sql)

export type AppointmentStatus = "scheduled" | "confirmed" | "completed" | "no_show" | "cancelled";
export type AppointmentSource = "manual" | "ai";

export type WorkingHour = {
  id?: string;
  weekday: number; // 0 = domingo
  start: string; // "08:00"
  end: string; // "12:00"
};

export type Professional = {
  id: string;
  name: string;
  specialty: string | null;
  color: string;
  userId: string | null;
  active: boolean;
  position: number;
  serviceIds: string[];
  hours: WorkingHour[];
};

export type ProfessionalInput = {
  name: string;
  specialty: string | null;
  color: string;
  userId: string | null;
  active: boolean;
  serviceIds: string[];
  hours: WorkingHour[];
};

export type AgendaService = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  price: number | null;
  active: boolean;
  position: number;
};

export type AgendaServiceInput = {
  name: string;
  description: string | null;
  durationMinutes: number;
  price: number | null;
  active: boolean;
  professionalIds: string[];
};

export type TimeOff = {
  id: string;
  professionalId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
};

export type Appointment = {
  id: string;
  professionalId: string;
  serviceId: string | null;
  contactId: string;
  contactName: string | null;
  contactPhone: string | null;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  notes: string | null;
  source: AppointmentSource;
  conversationId: string | null;
  cancelReason: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type AppointmentInput = {
  professionalId: string;
  serviceId: string | null;
  contactId: string;
  startsAt: string;
  endsAt: string;
  notes: string | null;
};

export type FreeSlot = { professionalId: string; startsAt: string; endsAt: string };

export type AgendaSettings = {
  timezone: string;
  slotStepMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  reminderEnabled: boolean;
  reminderHoursBefore: number;
  reminderConnectionId: string | null;
  reminderTemplateId: string | null;
  reminderMessage: string;
};
