import React, { useMemo, useState } from "react";
import { Conversation } from "../../types";
import { Button } from "../ui/Button";
import { TbMessageCheck, TbMessageOff } from "react-icons/tb";
import { HiOutlineSwitchHorizontal } from "react-icons/hi";
import { FiSearch } from "react-icons/fi";
import { CustomTooltip } from "../ui/CustomTooltip";
import { ArrowLeftIcon, TagIcon, MoreVerticalIcon } from "lucide-react";
import { CustomDropdown } from "../ui/CustomDropdown";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { SecureImage } from "../ui/SecureImage";

interface ChatHeaderProps {
  conversation: Conversation;
  onBack: () => void;
  onManageTags?: () => void;
  onAccept?: () => Promise<void> | void;
  onTransfer?: () => void;
  onSearch?: () => void;
  onRefresh?: () => Promise<void> | void;
  onClose?: () => Promise<void> | void;
  acceptDisabled?: boolean;
  transferDisabled?: boolean;
  closeDisabled?: boolean;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  conversation,
  onBack,
  onManageTags,
  onAccept,
  onTransfer,
  onSearch,
  onRefresh,
  onClose,
  acceptDisabled = false,
  transferDisabled = false,
  closeDisabled = false,
}) => {
  const [isAccepting, setIsAccepting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const isMobile = useIsMobile();

  const initials = useMemo(() => {
    const name = (conversation.contactName ?? "").trim();
    if (!name) return "--";
    return name
      .split(" ")
      .filter(Boolean)
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }, [conversation.contactName]);

  const avatar = conversation.contactAvatar;
  const formattedIdentifier = useMemo(() => {
    const rawValue = (conversation.contactNumber ?? "").trim();
    if (!rawValue) return "";

    const identifier = rawValue.includes("@")
      ? rawValue.split("@")[0].trim()
      : rawValue;
    const digits = identifier.replace(/\D/g, "");

    if (digits.length === 13 && digits.startsWith("55")) {
      return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
    }

    if (digits.length === 12 && digits.startsWith("55")) {
      return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
    }

    if (digits.length === 11) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    }

    if (digits.length === 10) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    }

    return identifier;
  }, [conversation.contactNumber]);

  const handleAccept = async () => {
    if (!onAccept || acceptDisabled || isAccepting) return;

    try {
      setIsAccepting(true);
      await onAccept();
      await onRefresh?.();
    } finally {
      setIsAccepting(false);
    }
  };

  const handleClose = async () => {
    if (!onClose || closeDisabled || isClosing) return;

    try {
      setIsClosing(true);
      await onClose();
      await onRefresh?.();
    } finally {
      setIsClosing(false);
    }
  };

  const acceptIsDisabled = acceptDisabled || isAccepting;
  const closeIsDisabled = closeDisabled || isClosing;

  const visibleTags = conversation.tags ?? [];
  const canAccept = !acceptIsDisabled && !!onAccept;

  // No celular as ações secundárias vão para o menu "mais"
  const dropdownItems = [
    ...(isMobile
      ? [
          {
            label: "Transferir conversa",
            icon: <HiOutlineSwitchHorizontal className="h-4 w-4" />,
            onSelect: () => onTransfer?.(),
            disabled: transferDisabled || !onTransfer,
          },
          {
            label: isClosing ? "Finalizando..." : "Finalizar conversa",
            icon: <TbMessageOff className="h-4 w-4" />,
            onSelect: () => void handleClose(),
            disabled: closeIsDisabled || !onClose,
            danger: true,
          },
        ]
      : []),
    {
      label: "Gerenciar Etiquetas",
      icon: <TagIcon className="h-4 w-4" />,
      onSelect: () => onManageTags?.(),
    },
  ];

  return (
    <div className="sticky top-0 z-10 shrink-0 border-b border-[#E5E7EB] bg-white px-2 py-2 sm:h-20 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <button
            onClick={onBack}
            className="flex-shrink-0 rounded-lg p-2 transition-colors hover:bg-[#E5E7EB]"
            aria-label="Voltar para conversas"
          >
            <ArrowLeftIcon className="h-5 w-5 text-[#1E1E1E]" />
          </button>

          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#0A84FF] font-medium text-white">
            {avatar ? (
              <SecureImage
                src={avatar}
                alt={`Foto de ${conversation.contactName}`}
                className="h-full w-full object-cover"
                fallback={initials}
              />
            ) : (
              initials
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold text-[#1E1E1E]">
              {conversation.contactName}
            </h2>

            <div className="mt-0.5 flex min-w-0 items-center gap-2 overflow-hidden">
              {formattedIdentifier && (
                <span className="min-w-0 truncate text-xs text-gray-500 sm:flex-shrink-0">
                  {formattedIdentifier}
                </span>
              )}

              {visibleTags.map((tag, index) => (
                <span
                  key={tag.id ?? tag.name}
                  title={tag.name}
                  className={`${
                    index > 0 ? "hidden sm:inline-block" : "inline-block"
                  } min-w-0 max-w-[9rem] select-none truncate rounded-full px-2 py-0.5 text-xs font-medium text-white sm:max-w-none sm:px-3 sm:py-1`}
                  style={{ backgroundColor: tag.color }}
                >
                  {tag.name}
                </span>
              ))}
              {visibleTags.length > 1 && (
                <span className="inline-flex flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 sm:hidden">
                  +{visibleTags.length - 1}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
          {onSearch && (
            <CustomTooltip text="Buscar na conversa">
              <Button variant="ghost" size="sm" onClick={onSearch}>
                <FiSearch className="h-5 w-5" />
              </Button>
            </CustomTooltip>
          )}

          {isMobile ? (
            conversation.status === "pending" && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleAccept}
                disabled={!canAccept}
                className="flex items-center gap-1.5 px-3"
              >
                <TbMessageCheck className="h-4 w-4" />
                Aceitar
              </Button>
            )
          ) : (
            <>
              <CustomTooltip
                text={isClosing ? "Finalizando..." : "Finalizar conversa"}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClose}
                  disabled={closeIsDisabled || !onClose}
                  aria-disabled={closeIsDisabled || !onClose}
                >
                  <TbMessageOff className="h-5 w-5" />
                </Button>
              </CustomTooltip>

              <CustomTooltip text="Transferir conversa">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onTransfer}
                  disabled={transferDisabled || !onTransfer}
                  aria-disabled={transferDisabled || !onTransfer}
                >
                  <HiOutlineSwitchHorizontal className="h-5 w-5" />
                </Button>
              </CustomTooltip>

              <CustomTooltip
                text={isAccepting ? "Aceitando..." : "Aceitar conversa"}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAccept}
                  disabled={acceptIsDisabled || !onAccept}
                  aria-disabled={acceptIsDisabled || !onAccept}
                >
                  <TbMessageCheck className="h-5 w-5" />
                </Button>
              </CustomTooltip>
            </>
          )}

          <CustomDropdown
            trigger={
              <Button variant="ghost" size="sm" aria-label="Mais ações">
                <MoreVerticalIcon className="h-5 w-5" />
              </Button>
            }
            items={dropdownItems}
          />
        </div>
      </div>
    </div>
  );
};
