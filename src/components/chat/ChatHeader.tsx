import React, { useMemo, useState } from "react";
import { Conversation } from "../../types";
import { Button } from "../ui/Button";
import { useConfirm } from "../ui/ConfirmDialog";
import { TbMessageCheck, TbMessageOff } from "react-icons/tb";
import { HiOutlineSwitchHorizontal } from "react-icons/hi";
import { FiSearch } from "react-icons/fi";
import { CustomTooltip } from "../ui/CustomTooltip";
import {
  ArrowLeftIcon,
  MessageCircleIcon,
  TagIcon,
  MoreVerticalIcon,
  PictureInPicture2Icon,
  UserIcon,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CustomDropdown } from "../ui/CustomDropdown";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { SecureImage } from "../ui/SecureImage";
import { WindowControls, type WindowControlsProps } from "./WindowControls";

interface ChatHeaderProps {
  conversation: Conversation;
  // Responsável pela conversa (exibido só para admin)
  assigneeName?: string;
  // Setor em que a conversa está
  departmentName?: string;
  // Número da empresa por onde a conversa acontece (só com mais de um)
  connectionLabel?: string;
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
  // Caixa flutuante: cabeçalho enxuto, ações no menu "mais" e botões da janela
  compact?: boolean;
  windowControls?: WindowControlsProps;
  // Tela cheia no computador: botão para levar a conversa para uma caixa
  onPopOut?: () => void;
}

const STATUS_BADGE: Record<
  Conversation["status"],
  { label: string; className: string }
> = {
  open: { label: "Em atendimento", className: "bg-green-50 text-green-700" },
  pending: { label: "Na fila", className: "bg-amber-50 text-amber-700" },
  closed: { label: "Finalizada", className: "bg-gray-100 text-gray-600" },
};

const BOT_BADGE = { label: "No bot", className: "bg-violet-50 text-violet-700" };

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  conversation,
  assigneeName,
  departmentName,
  connectionLabel,
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
  compact = false,
  windowControls,
  onPopOut,
}) => {
  const [isAccepting, setIsAccepting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const isMobile = useIsMobile();
  const confirm = useConfirm();

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
    // Um toque no ícone encerrava o atendimento (e disparava a pesquisa de
    // satisfação para o cliente) sem chance de voltar atrás
    const ok = await confirm({
      title: "Finalizar esta conversa?",
      description:
        "O atendimento será encerrado e o cliente poderá receber a pesquisa de satisfação.",
      confirmLabel: "Finalizar",
      tone: "warning",
    });
    if (!ok) return;

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

  const statusBadge =
    conversation.status === "pending" && conversation.inBotFlow
      ? BOT_BADGE
      : STATUS_BADGE[conversation.status];

  const visibleTags = conversation.tags ?? [];
  const canAccept = !acceptIsDisabled && !!onAccept;

  // No celular as ações secundárias vão para o menu "mais"
  const dropdownItems = [
    ...(isMobile && onTransfer
      ? [
          {
            label: "Transferir conversa",
            icon: <HiOutlineSwitchHorizontal className="h-4 w-4 text-blue-600" />,
            onSelect: () => onTransfer?.(),
            disabled: transferDisabled || !onTransfer,
          },
        ]
      : []),
    {
      label: "Gerenciar Etiquetas",
      icon: <TagIcon className="h-4 w-4" />,
      onSelect: () => onManageTags?.(),
    },
    // Ação destrutiva sempre por último
    ...(isMobile
      ? [
          {
            label: isClosing ? "Finalizando..." : "Finalizar conversa",
            icon: <TbMessageOff className="h-4 w-4" />,
            onSelect: () => void handleClose(),
            disabled: closeIsDisabled || !onClose,
            danger: true,
          },
        ]
      : []),
  ];

  // Caixa flutuante: nome e botões em cima, selos e etiquetas embaixo, com a
  // largura toda. O "Aceitar" fica no rodapé da caixa (ConversationView).
  if (compact) {
    const [firstTag, ...otherTags] = visibleTags;
    const compactItems = [
      ...(onTransfer
        ? [
            {
              label: "Transferir conversa",
              icon: <HiOutlineSwitchHorizontal className="h-4 w-4 text-blue-600" />,
              onSelect: () => onTransfer?.(),
              disabled: transferDisabled,
            },
          ]
        : []),
      {
        label: "Gerenciar etiquetas",
        icon: <TagIcon className="h-4 w-4" />,
        onSelect: () => onManageTags?.(),
      },
      {
        label: isClosing ? "Finalizando..." : "Finalizar conversa",
        icon: <TbMessageOff className="h-4 w-4" />,
        onSelect: () => void handleClose(),
        disabled: closeIsDisabled || !onClose,
        danger: true,
      },
    ];

    return (
      <div className="shrink-0 border-b border-[#E5E7EB] bg-white px-2 pb-2 pt-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={windowControls?.onMinimize}
            title="Minimizar"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-0.5 pr-1 text-left"
          >
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#0A84FF] text-xs font-medium text-white">
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
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#1E1E1E]">
              {conversation.contactName}
            </span>
          </button>

          <CustomDropdown
            trigger={
              <button
                type="button"
                aria-label="Mais ações"
                title="Mais ações"
                className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
              >
                <MoreVerticalIcon className="h-4 w-4" />
              </button>
            }
            items={compactItems}
          />
          {windowControls && <WindowControls {...windowControls} />}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span
            className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadge.className}`}
          >
            {statusBadge.label}
          </span>

          {conversation.slaBreached && (
            <span
              title="O cliente aguarda a primeira resposta há mais tempo que o prazo definido"
              className="whitespace-nowrap rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700"
            >
              SLA estourado
            </span>
          )}

          {firstTag && (
            <span
              title={firstTag.name}
              className="max-w-[8rem] truncate rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
              style={{ backgroundColor: firstTag.color }}
            >
              {firstTag.name}
            </span>
          )}

          {otherTags.length > 0 && (
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  title="Ver todas as etiquetas"
                  aria-label={`Ver todas as ${visibleTags.length} etiquetas`}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-200"
                >
                  +{otherTags.length}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="start"
                  sideOffset={6}
                  className="z-[10000] w-60 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
                >
                  <p className="mb-2 text-xs font-semibold text-gray-500">
                    Etiquetas
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {visibleTags.map((tag) => (
                      <span
                        key={tag.id ?? tag.name}
                        className="max-w-full truncate rounded-full px-2.5 py-1 text-xs font-medium text-white"
                        style={{ backgroundColor: tag.color }}
                        title={tag.name}
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                  {onManageTags && (
                    <DropdownMenu.Item
                      onSelect={() => onManageTags()}
                      className="mt-3 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[#0A84FF] outline-none hover:bg-blue-50 focus:bg-blue-50"
                    >
                      <TagIcon className="h-4 w-4" />
                      Gerenciar etiquetas
                    </DropdownMenu.Item>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
        </div>
      </div>
    );
  }

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

              <span
                className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadge.className}`}
              >
                {statusBadge.label}
              </span>

              {conversation.slaBreached && (
                <span
                  title="O cliente aguarda a primeira resposta há mais tempo que o prazo definido"
                  className="flex-shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700"
                >
                  SLA estourado
                </span>
              )}

              {connectionLabel && (
                <span
                  title={`Número da empresa: ${connectionLabel}`}
                  className="inline-flex min-w-0 max-w-[10rem] flex-shrink-0 items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700"
                >
                  <MessageCircleIcon className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{connectionLabel}</span>
                </span>
              )}

              {departmentName && (
                <span
                  title={`Setor: ${departmentName}`}
                  className="hidden min-w-0 max-w-[10rem] flex-shrink-0 truncate text-xs text-gray-500 sm:inline"
                >
                  {departmentName}
                </span>
              )}

              {assigneeName && (
                <span
                  title={`Responsável: ${assigneeName}`}
                  className="inline-flex min-w-0 max-w-[10rem] flex-shrink-0 items-center gap-1 text-xs text-gray-500"
                >
                  <UserIcon className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate">{assigneeName}</span>
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
              {onTransfer && (
                <CustomTooltip text="Transferir conversa">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onTransfer}
                    disabled={transferDisabled}
                    aria-disabled={transferDisabled}
                  >
                    <HiOutlineSwitchHorizontal className="h-5 w-5 text-blue-600" />
                  </Button>
                </CustomTooltip>
              )}

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
                  <TbMessageCheck className="h-5 w-5 text-green-600" />
                </Button>
              </CustomTooltip>

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
                  <TbMessageOff className="h-5 w-5 text-red-600" />
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

          {onPopOut && (
            <span className="hidden lg:inline-flex">
              <CustomTooltip text="Abrir em janela flutuante">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onPopOut}
                  aria-label="Abrir em janela flutuante"
                >
                  <PictureInPicture2Icon className="h-5 w-5" />
                </Button>
              </CustomTooltip>
            </span>
          )}

        </div>
      </div>
    </div>
  );
};
