import {
  EXTRA_ATTENDANTS_MAX,
  EXTRA_ATTENDANTS_MIN,
} from "../lib/subscriptions";

// Atendentes extras: vagas a mais além do limite do plano (só nos planos com
// limite). Usado ao editar a assinatura de uma empresa.
export const ExtraAttendantsField = ({
  planLimit,
  enabled,
  quantity,
  onEnabledChange,
  onQuantityChange,
}: {
  planLimit: number;
  enabled: boolean;
  quantity: string;
  onEnabledChange: (enabled: boolean) => void;
  onQuantityChange: (quantity: string) => void;
}) => {
  const extra = Number(quantity);
  const total = Number.isInteger(extra) && extra > 0 ? planLimit + extra : null;

  return (
    <fieldset className="rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-sm font-medium text-gray-900">
        Atendentes
      </legend>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#003366] focus:ring-[#0A84FF]"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-800">
            Atendentes extras
          </span>
          <span className="block text-xs text-slate-500">
            O plano permite {planLimit}. Libere mais vagas sem mudar de plano.
          </span>
        </span>
      </label>
      {enabled && (
        <label className="mt-3 flex flex-wrap items-center gap-2 pl-7 text-sm text-slate-700">
          Mais
          <input
            type="number"
            min={EXTRA_ATTENDANTS_MIN}
            max={EXTRA_ATTENDANTS_MAX}
            value={quantity}
            onChange={(e) => onQuantityChange(e.target.value)}
            className="w-20 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
            aria-label="Quantidade de atendentes extras"
          />
          {extra === 1 ? "atendente" : "atendentes"}
          {total !== null && (
            <span className="text-xs text-slate-500">
              (total de {total})
            </span>
          )}
        </label>
      )}
    </fieldset>
  );
};
