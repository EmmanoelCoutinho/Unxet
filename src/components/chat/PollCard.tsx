import React, { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { BarChart3, Check } from "lucide-react";
import type { Message as UiMessage } from "../../types";
import { tallyPoll, type PollVoter, type WhatsappPoll } from "../../lib/whatsappPoll";
import { CloseButton } from "../ui/CloseButton";

interface PollCardProps {
  poll: WhatsappPoll;
  votes: UiMessage["pollVotes"];
  /** Enquete enviada pela empresa (balão azul) */
  outgoing: boolean;
  contactName?: string;
  isGroup?: boolean;
}

const formatVoteTime = (iso?: string) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/**
 * Enquete do WhatsApp como no celular: pergunta, opções com a quantidade de
 * votos e a barra, e "Ver votos" com quem escolheu cada opção. Votar não dá:
 * a Evolution não tem como enviar voto, então o voto é feito no celular.
 */
export const PollCard: React.FC<PollCardProps> = ({
  poll,
  votes,
  outgoing,
  contactName,
  isGroup,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const tally = useMemo(() => tallyPoll(poll, votes), [poll, votes]);

  const voterName = (voter: PollVoter) => {
    if (voter.fromMe) return "Empresa (WhatsApp do celular)";
    if (!isGroup && contactName) return contactName;
    return voter.name || contactName || "Cliente";
  };

  const muted = outgoing ? "text-blue-100" : "text-gray-500";

  return (
    <div className="w-72 max-w-full">
      <div className="flex items-start gap-2">
        <BarChart3 className={`mt-0.5 h-4 w-4 shrink-0 ${muted}`} aria-hidden />
        <p className="break-words text-sm font-semibold">{poll.name || "Enquete"}</p>
      </div>
      <p className={`mt-1 text-xs ${muted}`}>
        Para votar, use o WhatsApp no celular da empresa
        {poll.multiple ? " (aceita mais de uma opção)" : ""}
      </p>

      <ul className="mt-3 space-y-3">
        {tally.options.map((option) => {
          const count = option.voters.length;
          const pct = tally.maxVotes ? Math.round((count / tally.maxVotes) * 100) : 0;
          const companyVoted = option.voters.some((v) => v.fromMe);
          return (
            <li key={option.name}>
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border ${
                    poll.multiple ? "rounded" : "rounded-full"
                  } ${
                    companyVoted
                      ? outgoing
                        ? "border-white bg-white text-[#0A84FF]"
                        : "border-[#0A84FF] bg-[#0A84FF] text-white"
                      : outgoing
                        ? "border-white/70"
                        : "border-gray-400"
                  }`}
                  aria-hidden
                >
                  {companyVoted && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 break-words text-sm">{option.name}</span>
                <span className={`shrink-0 text-sm font-medium tabular-nums ${count ? "" : muted}`}>
                  {count}
                </span>
              </div>
              <div
                className={`ml-6 mt-1.5 h-1.5 overflow-hidden rounded-full ${
                  outgoing ? "bg-[#fff]/25" : "bg-gray-300"
                }`}
              >
                <div
                  className={`h-full rounded-full transition-all ${
                    outgoing ? "bg-white" : "bg-[#0A84FF]"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <div
        className={`-mx-4 -mb-3 mt-3 border-t ${
          outgoing ? "border-white/25" : "border-gray-300"
        }`}
      >
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          disabled={!tally.totalVoters}
          title={tally.totalVoters ? undefined : "Ninguém votou ainda"}
          className={`w-full rounded-b-lg py-2 text-sm font-medium transition-colors disabled:cursor-default ${
            outgoing
              ? "text-white hover:bg-[#fff]/10 disabled:text-blue-100 disabled:hover:bg-transparent"
              : "text-[#0A84FF] hover:bg-gray-300/60 disabled:text-gray-500 disabled:hover:bg-transparent"
          }`}
        >
          {tally.totalVoters
            ? `Ver votos (${tally.totalVoters})`
            : "Nenhum voto ainda"}
        </button>
      </div>

      <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[80] flex max-h-[85dvh] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-5">
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold text-gray-900">
                  Votos da enquete
                </Dialog.Title>
                <Dialog.Description className="mt-1 break-words text-sm text-gray-600">
                  {poll.name || "Enquete"}
                </Dialog.Description>
              </div>
              <CloseButton className="-mr-2 -mt-1" onClick={() => setIsOpen(false)} />
            </div>
            <div className="space-y-4 overflow-y-auto p-5">
              {tally.options.map((option) => (
                <section key={option.name}>
                  <div className="flex items-baseline justify-between gap-3">
                    <h4 className="min-w-0 break-words text-sm font-semibold text-gray-900">
                      {option.name}
                    </h4>
                    <span className="shrink-0 text-xs text-gray-500">
                      {option.voters.length === 1
                        ? "1 voto"
                        : `${option.voters.length} votos`}
                    </span>
                  </div>
                  {option.voters.length ? (
                    <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
                      {option.voters.map((voter) => (
                        <li
                          key={voter.key}
                          className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                        >
                          <span className="min-w-0 truncate text-gray-800">
                            {voterName(voter)}
                          </span>
                          <span className="shrink-0 text-xs text-gray-500">
                            {formatVoteTime(voter.at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-gray-500">Ninguém escolheu esta opção.</p>
                  )}
                </section>
              ))}
              <p className="text-xs text-gray-500">
                Para votar, use o WhatsApp no celular da empresa. O voto aparece aqui em seguida.
              </p>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
};
