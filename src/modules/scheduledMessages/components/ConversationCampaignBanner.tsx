import React, { useEffect, useRef, useState } from "react";
import { CheckIcon, MegaphoneIcon, XIcon } from "lucide-react";
import { toast } from "react-toastify";
import {
  useCampaignConversion,
  useConversationCampaign,
} from "../hooks/useScheduledMessages";
import { campaignTitle, formatCurrency, parseMoneyInput } from "../utils/schedule";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

/**
 * Faixa no topo da conversa quando o cliente recebeu uma campanha há pouco
 * (dentro do prazo de acompanhamento). Mostra de qual campanha veio e deixa
 * marcar a adesão, com valor opcional.
 */
export const ConversationCampaignBanner: React.FC<{
  conversationId: string;
  // Muda quando as etiquetas da conversa mudam: a etiqueta de conversão
  // marca a adesão no banco e a faixa precisa refletir
  tagsKey: string;
  compact?: boolean;
}> = ({ conversationId, tagsKey, compact = false }) => {
  const { campaign, refetch } = useConversationCampaign(conversationId);
  const conversion = useCampaignConversion(conversationId);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const firstTagsKey = useRef(tagsKey);

  useEffect(() => {
    if (tagsKey === firstTagsKey.current) return;
    firstTagsKey.current = tagsKey;
    refetch();
  }, [tagsKey, refetch]);

  useEffect(() => {
    setEditing(false);
    setValue("");
  }, [conversationId]);

  if (!campaign) return null;

  const title = campaignTitle({
    name: campaign.campaignName,
    message: campaign.campaignMessage,
  });

  const submit = async (converted: boolean) => {
    const parsed = converted ? parseMoneyInput(value) : null;
    if (parsed !== null && Number.isNaN(parsed)) {
      toast.error("Valor inválido. Ex.: 150 ou 1.500,00");
      return;
    }
    try {
      await conversion.mutateAsync({
        recipientId: campaign.recipientId,
        converted,
        value: parsed,
      });
      setEditing(false);
      setValue("");
      toast.success(converted ? "Adesão registrada na campanha." : "Adesão desfeita.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível salvar.");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-900">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <MegaphoneIcon className="h-3.5 w-3.5 flex-shrink-0 text-violet-600" />
        <span className="min-w-0 truncate">
          Veio da campanha <strong className="font-semibold">{title}</strong>
          {!compact && <> · enviada em {shortDate(campaign.sentAt)}</>}
        </span>
      </span>

      {campaign.convertedAt ? (
        <span className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-800">
            <CheckIcon className="h-3 w-3" />
            Aderiu
            {campaign.conversionValue ? ` · ${formatCurrency(campaign.conversionValue)}` : ""}
            {campaign.convertedVia === "tag" ? " (etiqueta)" : ""}
          </span>
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={conversion.isPending}
            className="font-medium text-violet-700 hover:underline disabled:opacity-50"
          >
            Desfazer
          </button>
        </span>
      ) : editing ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            submit(true);
          }}
        >
          <label htmlFor={`campaign-value-${conversationId}`} className="sr-only">
            Valor da adesão
          </label>
          <input
            id={`campaign-value-${conversationId}`}
            type="text"
            inputMode="decimal"
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Valor R$ (opcional)"
            className="w-36 rounded-lg border border-violet-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-violet-400"
          />
          <button
            type="submit"
            disabled={conversion.isPending}
            className="rounded-lg bg-green-600 px-2.5 py-1 font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            Confirmar
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded p-1 text-violet-600 hover:bg-violet-100"
            aria-label="Cancelar"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 rounded-full border border-green-300 bg-white px-2.5 py-1 font-semibold text-green-700 hover:bg-green-50"
        >
          <CheckIcon className="h-3 w-3" />
          Aderiu
        </button>
      )}
    </div>
  );
};
