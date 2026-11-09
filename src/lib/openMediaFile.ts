import { toast } from "react-toastify";
import { resolveMediaUrl } from "./mediaUrls";

/**
 * Abre um arquivo do bucket privado numa aba nova. A aba é aberta antes de
 * pedir o link assinado para o navegador não bloquear como pop-up.
 */
export const openMediaFile = async (url: string) => {
  const tab = window.open("about:blank", "_blank");
  try {
    const signed = await resolveMediaUrl(url);
    if (!signed) throw new Error("no_access");
    if (tab) {
      tab.opener = null;
      tab.location.href = signed;
    } else {
      window.open(signed, "_blank", "noopener");
    }
  } catch {
    tab?.close();
    toast.error("Não foi possível abrir o arquivo.");
  }
};
