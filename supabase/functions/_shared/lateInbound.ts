// deno-lint-ignore-file
// @ts-nocheck
// Mensagem do cliente que chegou com muito atraso (sem dependências,
// testável no Vitest).
//
// Em 17/11/2026 a Evolution entregou de madrugada mensagens escritas na tarde
// anterior. Elas entravam como novas: reabriam conversas já encerradas e o bot
// mandava boas-vindas e menu a quem tinha escrito horas antes. Mensagem
// atrasada entra na conversa com o horário original e não aciona bot nem IA.
// Só reabre conversa encerrada se for a mais recente do cliente (se ele
// escreveu depois, a conversa já seguiu sem ela).

/** A partir de quanto tempo entre o cliente escrever e a mensagem chegar. */
export const LATE_INBOUND_MINUTES = 30;

/**
 * A mensagem foi escrita (horário do WhatsApp) há mais de
 * LATE_INBOUND_MINUTES? Horário ausente ou inválido não conta como atraso.
 */
export const isLateInbound = (sentAt: unknown, now = new Date()) => {
  if (!sentAt) return false;
  const sent = new Date(sentAt as string).getTime();
  if (Number.isNaN(sent)) return false;
  return now.getTime() - sent > LATE_INBOUND_MINUTES * 60000;
};

/**
 * Horário de chegada para o "aguardando resposta desde": a mensagem
 * atrasada conta de quando chegou, senão a conversa entra na fila com o
 * prazo de resposta já estourado.
 */
export const unansweredSince = (sentAt: string, late: boolean, now = new Date()) =>
  late ? now.toISOString() : sentAt;
