import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabaseClient";
import {
  DEFAULT_SETTINGS,
  createAppointment,
  createTimeOff,
  deleteService,
  deleteTimeOff,
  getAgendaSettings,
  getAppointmentReminder,
  listAppointments,
  listContactAppointments,
  listFreeSlots,
  listProfessionals,
  listServices,
  listTimeOff,
  removeProfessional,
  saveAgendaSettings,
  saveProfessional,
  saveService,
  setAppointmentStatus,
  updateAppointment,
} from "../api/agenda";
import type {
  AgendaServiceInput,
  AgendaSettings,
  AppointmentInput,
  AppointmentStatus,
  ProfessionalInput,
} from "../types";

export const agendaKeys = {
  all: ["agenda"] as const,
  professionals: (clinicId: string | null) => [...agendaKeys.all, "professionals", clinicId] as const,
  services: (clinicId: string | null) => [...agendaKeys.all, "services", clinicId] as const,
  settings: (clinicId: string | null) => [...agendaKeys.all, "settings", clinicId] as const,
  appointments: (clinicId: string | null, from: string, to: string) =>
    [...agendaKeys.all, "appointments", clinicId, from, to] as const,
  appointmentsAll: (clinicId: string | null) => [...agendaKeys.all, "appointments", clinicId] as const,
  timeOff: (clinicId: string | null, from: string, to: string) =>
    [...agendaKeys.all, "time-off", clinicId, from, to] as const,
  contact: (contactId: string | null) => [...agendaKeys.all, "contact", contactId] as const,
  slots: (key: string) => [...agendaKeys.all, "slots", key] as const,
  reminder: (id: string | null) => [...agendaKeys.all, "reminder", id] as const,
};

export const useProfessionals = (clinicId: string | null) => {
  const query = useQuery({
    queryKey: agendaKeys.professionals(clinicId),
    queryFn: () => listProfessionals(clinicId),
    enabled: Boolean(clinicId),
  });
  return { professionals: query.data ?? [], loading: query.isLoading, error: query.error };
};

export const useAgendaServices = (clinicId: string | null) => {
  const query = useQuery({
    queryKey: agendaKeys.services(clinicId),
    queryFn: () => listServices(clinicId),
    enabled: Boolean(clinicId),
  });
  return { services: query.data ?? [], loading: query.isLoading, error: query.error };
};

export const useAgendaSettings = (clinicId: string | null) => {
  const query = useQuery({
    queryKey: agendaKeys.settings(clinicId),
    queryFn: () => getAgendaSettings(clinicId),
    enabled: Boolean(clinicId),
  });
  return { settings: query.data ?? DEFAULT_SETTINGS, loading: query.isLoading };
};

/** Agendamentos do período, atualizados em tempo real (a IA marca pelo WhatsApp). */
export const useAppointments = (clinicId: string | null, from: Date, to: Date) => {
  const queryClient = useQueryClient();
  const fromKey = from.toISOString();
  const toKey = to.toISOString();
  const query = useQuery({
    queryKey: agendaKeys.appointments(clinicId, fromKey, toKey),
    queryFn: () => listAppointments(clinicId, from, to),
    enabled: Boolean(clinicId),
    // Garantia caso o tempo real caia
    refetchInterval: 60000,
  });

  useEffect(() => {
    if (!clinicId) return;
    const channel = supabase
      .channel(`agenda-${clinicId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `clinic_id=eq.${clinicId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: agendaKeys.appointmentsAll(clinicId) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [clinicId, queryClient]);

  return { appointments: query.data ?? [], loading: query.isLoading, error: query.error };
};

export const useTimeOff = (clinicId: string | null, from: Date, to: Date) => {
  const query = useQuery({
    queryKey: agendaKeys.timeOff(clinicId, from.toISOString(), to.toISOString()),
    queryFn: () => listTimeOff(clinicId, from, to),
    enabled: Boolean(clinicId),
  });
  return { timeOff: query.data ?? [], loading: query.isLoading };
};

export const useContactAppointments = (clinicId: string | null, contactId: string | null) => {
  const query = useQuery({
    queryKey: agendaKeys.contact(contactId),
    queryFn: () => listContactAppointments(clinicId, contactId),
    enabled: Boolean(clinicId && contactId),
  });
  return { appointments: query.data ?? [], loading: query.isLoading };
};

export const useFreeSlots = (params: {
  clinicId: string | null;
  serviceId: string | null;
  professionalId: string | null;
  date: string;
  enabled: boolean;
}) => {
  const { clinicId, serviceId, professionalId, date, enabled } = params;
  const query = useQuery({
    queryKey: agendaKeys.slots([clinicId, serviceId, professionalId, date].join("|")),
    queryFn: () =>
      listFreeSlots({ clinicId: clinicId!, serviceId: serviceId!, professionalId, date }),
    enabled: Boolean(enabled && clinicId && serviceId && date),
    staleTime: 15000,
  });
  return { slots: query.data ?? [], loading: query.isFetching };
};

export const useAppointmentReminder = (appointmentId: string | null, enabled: boolean) => {
  const query = useQuery({
    queryKey: agendaKeys.reminder(appointmentId),
    queryFn: () => getAppointmentReminder(appointmentId!),
    enabled: Boolean(appointmentId && enabled),
  });
  return query.data ?? null;
};

export const useAgendaActions = (clinicId: string | null) => {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: agendaKeys.all });

  const saveProfessionalMutation = useMutation({
    mutationFn: (args: { id: string | null; input: ProfessionalInput; position: number }) =>
      saveProfessional(clinicId!, args.id, args.input, args.position),
    onSettled: invalidate,
  });
  const removeProfessionalMutation = useMutation({
    mutationFn: (id: string) => removeProfessional(id),
    onSettled: invalidate,
  });
  const saveServiceMutation = useMutation({
    mutationFn: (args: { id: string | null; input: AgendaServiceInput; position: number }) =>
      saveService(clinicId!, args.id, args.input, args.position),
    onSettled: invalidate,
  });
  const deleteServiceMutation = useMutation({
    mutationFn: (id: string) => deleteService(id),
    onSettled: invalidate,
  });
  const createTimeOffMutation = useMutation({
    mutationFn: (input: { professionalId: string; startsAt: string; endsAt: string; reason: string | null }) =>
      createTimeOff(clinicId!, input),
    onSettled: invalidate,
  });
  const deleteTimeOffMutation = useMutation({
    mutationFn: (id: string) => deleteTimeOff(id),
    onSettled: invalidate,
  });
  const createAppointmentMutation = useMutation({
    mutationFn: (input: AppointmentInput) => createAppointment(clinicId!, input),
    onSettled: invalidate,
  });
  const updateAppointmentMutation = useMutation({
    mutationFn: (args: { id: string; input: AppointmentInput }) => updateAppointment(args.id, args.input),
    onSettled: invalidate,
  });
  const statusMutation = useMutation({
    mutationFn: (args: { id: string; status: AppointmentStatus; reason?: string | null }) =>
      setAppointmentStatus(args.id, args.status, args.reason),
    onSettled: invalidate,
  });
  const settingsMutation = useMutation({
    mutationFn: (settings: AgendaSettings) => saveAgendaSettings(clinicId!, settings),
    onSettled: invalidate,
  });

  return {
    saveProfessional: saveProfessionalMutation.mutateAsync,
    savingProfessional: saveProfessionalMutation.isPending,
    removeProfessional: removeProfessionalMutation.mutateAsync,
    saveService: saveServiceMutation.mutateAsync,
    savingService: saveServiceMutation.isPending,
    deleteService: deleteServiceMutation.mutateAsync,
    createTimeOff: createTimeOffMutation.mutateAsync,
    deleteTimeOff: deleteTimeOffMutation.mutateAsync,
    createAppointment: createAppointmentMutation.mutateAsync,
    updateAppointment: updateAppointmentMutation.mutateAsync,
    savingAppointment: createAppointmentMutation.isPending || updateAppointmentMutation.isPending,
    setStatus: statusMutation.mutateAsync,
    changingStatus: statusMutation.isPending,
    saveSettings: settingsMutation.mutateAsync,
    savingSettings: settingsMutation.isPending,
  };
};
