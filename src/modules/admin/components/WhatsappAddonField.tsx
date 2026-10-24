import { WHATSAPP_ADDON_MAX, WHATSAPP_ADDON_MIN } from "../lib/subscriptions";

// Adicional "Vários números de WhatsApp" (QR Code), usado ao criar e ao
// editar a assinatura de uma empresa
export const WhatsappAddonField = ({
  enabled,
  quantity,
  onEnabledChange,
  onQuantityChange,
}: {
  enabled: boolean;
  quantity: string;
  onEnabledChange: (enabled: boolean) => void;
  onQuantityChange: (quantity: string) => void;
}) => (
  <fieldset className="rounded-lg border border-slate-200 p-3">
    <legend className="px-1 text-sm font-medium text-[#1E1E1E]">
      Adicionais
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
          Vários números de WhatsApp (QR Code)
        </span>
        <span className="block text-xs text-slate-500">
          A empresa conecta mais de um número, cada um com nome e departamento
          próprios. Sem o adicional, a tela continua com um número só.
        </span>
      </span>
    </label>
    {enabled && (
      <label className="mt-3 flex items-center gap-2 pl-7 text-sm text-slate-700">
        Até
        <input
          type="number"
          min={WHATSAPP_ADDON_MIN}
          max={WHATSAPP_ADDON_MAX}
          value={quantity}
          onChange={(e) => onQuantityChange(e.target.value)}
          className="w-20 rounded-lg border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF]"
          aria-label="Quantidade de números de WhatsApp"
        />
        números
      </label>
    )}
  </fieldset>
);
