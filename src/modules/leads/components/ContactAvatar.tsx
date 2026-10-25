import React, { useEffect, useState } from "react";
import { UserIcon } from "lucide-react";
import { SecureImage } from "../../../components/ui/SecureImage";
import type { DealContact } from "../types/leads";
import { initials } from "../utils/board";

/**
 * Foto do cliente (a mesma das conversas). Sem foto, ou se ela não carregar
 * (o link da foto de perfil do WhatsApp expira), mostra as iniciais; sem
 * nome, um ícone.
 */
export const ContactAvatar: React.FC<{
  contact: DealContact;
  label: string;
  size?: "sm" | "md";
}> = ({ contact, label, size = "sm" }) => {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [contact.imageUrl]);

  const letters = initials(contact.name);
  const fallback =
    letters === "?" ? <UserIcon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} /> : letters;

  return (
    <span
      className={`flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#0A84FF] font-medium text-white ${
        size === "sm" ? "h-8 w-8 text-xs" : "h-11 w-11 text-sm"
      }`}
    >
      {contact.imageUrl && !broken ? (
        <SecureImage
          src={contact.imageUrl}
          alt={`Foto de ${label}`}
          className="h-full w-full object-cover"
          fallback={fallback}
          draggable={false}
          onError={() => setBroken(true)}
        />
      ) : (
        fallback
      )}
    </span>
  );
};
