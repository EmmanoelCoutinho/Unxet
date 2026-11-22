import type { Message as UiMessage } from "../types";

// Enquete do WhatsApp (QR Code). A enquete fica no payload da mensagem (o
// webhook da Evolution) e os votos em messages.poll_votes, gravados pelo
// evolution-in (ver supabase/functions/_shared/pollVote.ts).

export interface WhatsappPoll {
  name: string;
  options: string[];
  /** Aceita mais de uma opção por pessoa */
  multiple: boolean;
}

export interface PollVoter {
  key: string;
  /** Nome de quem votou (vazio: o cliente da conversa) */
  name: string | null;
  fromMe: boolean;
  at?: string;
}

export interface PollTally {
  options: { name: string; voters: PollVoter[] }[];
  /** Pessoas que votaram (com pelo menos uma opção) */
  totalVoters: number;
  /** Maior número de votos de uma opção (para a barra) */
  maxVotes: number;
}

const WRAPPERS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "futureProofMessage",
  "deviceSentMessage",
];

function unwrap(message: any): any {
  let current = message ?? {};
  for (let depth = 0; depth < 5; depth++) {
    const key = WRAPPERS.find((k) => current?.[k]?.message);
    if (!key) break;
    current = current[key].message;
  }
  return current ?? {};
}

const clean = (value: unknown) => String(value ?? "").trim();

/** Enquete da mensagem, ou null se não for enquete. */
export function pollFromPayload(payload: any): WhatsappPoll | null {
  const raw =
    payload?.data?.message ?? payload?.rawPayload?.data?.message ?? payload?.message;
  if (!raw || typeof raw !== "object") return null;
  const msg = unwrap(raw);
  const poll =
    msg.pollCreationMessage ??
    msg.pollCreationMessageV2 ??
    msg.pollCreationMessageV3 ??
    msg.pollCreationMessageV5;
  if (!poll) return null;
  const options = (Array.isArray(poll.options) ? poll.options : [])
    .map((o: any) => clean(o?.optionName))
    .filter(Boolean);
  if (!options.length) return null;
  return {
    name: clean(poll.name),
    options,
    multiple: Number(poll.selectableOptionsCount ?? 0) !== 1,
  };
}

/** Votos por opção, na ordem da enquete. */
export function tallyPoll(
  poll: WhatsappPoll,
  votes: UiMessage["pollVotes"] | undefined,
): PollTally {
  const options = poll.options.map((name) => ({ name, voters: [] as PollVoter[] }));
  let totalVoters = 0;
  for (const [key, vote] of Object.entries(votes ?? {})) {
    const chosen = (vote?.options ?? []).filter((o) => poll.options.includes(o));
    if (!chosen.length) continue;
    totalVoters++;
    const voter: PollVoter = {
      key,
      name: clean(vote?.name) || null,
      fromMe: vote?.fromMe === true,
      at: vote?.at,
    };
    for (const option of options) {
      if (chosen.includes(option.name)) option.voters.push(voter);
    }
  }
  const maxVotes = Math.max(0, ...options.map((o) => o.voters.length));
  return { options, totalVoters, maxVotes };
}
