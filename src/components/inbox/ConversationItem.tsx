import React from "react";
import {
  MessageCircleIcon,
  InstagramIcon,
  FacebookIcon,
  ImageIcon,
} from "lucide-react";
import { Conversation } from "../../types";
import { CustomTooltip } from "../ui/CustomTooltip";
interface ConversationItemProps {
  conversation: Conversation;
  onClick: () => void;
}
type Channel = "whatsapp" | "instagram" | "messenger";

export const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  onClick,
}) => {  
  
  const CHANNEL_CONFIG: Record<
    Channel,
    {
      name: string;
      icon: JSX.Element;
      textColor: string;
    }
  > = {
    whatsapp: {
      name: "WhatsApp",
      icon: <MessageCircleIcon className="w-4 h-4 text-green-600" />,
      textColor: "text-green-600",
    },
    instagram: {
      name: "Instagram",
      icon: <InstagramIcon className="w-4 h-4 text-pink-600" />,
      textColor: "text-pink-600",
    },
    messenger: {
      name: "Messenger",
      icon: <FacebookIcon className="w-4 h-4 text-blue-600" />,
      textColor: "text-blue-600",
    },
  };

  const getChannelInfo = (channel: Channel) => {
    return CHANNEL_CONFIG[channel];
  };
  const channelInfo = getChannelInfo(conversation.channel);
  const visibleTag = conversation.tags?.[0];
  const hiddenTags = conversation.tags?.slice(1) ?? [];
  const hiddenTagsCount = hiddenTags.length;

  const getTimeAgo = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `há ${days}d`;
    if (hours > 0) return `há ${hours}h`;
    if (minutes > 0) return `há ${minutes} min`;
    return "agora";
  };
  const initials = conversation.contactName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const renderLastMessage = () => {
    if (conversation.lastMessageType === "image") {
      return (
        <span className="flex items-center gap-1 text-sm text-gray-600 truncate">
          <ImageIcon className="w-4 h-4 text-gray-500" />
          <span className="truncate">
            {conversation.lastMessage || "Imagem"}
          </span>
        </span>
      );
    }
    return conversation.lastMessage;
  };

  const renderTagPill = (tag: Conversation["tags"][number]) => {
    if (!tag) return null;

    return (
      <span
        key={tag.id}
        title={tag.name}
        className="inline-block min-w-0 max-w-[120px] truncate rounded-full px-3 py-1 text-xs font-medium text-white select-none"
        style={{ backgroundColor: tag.color ?? "#0A84FF" }}
      >
        {tag.name}
      </span>
    );
  };

  return (
    <div
      onClick={onClick}
      className="p-4 hover:bg-[#E5E7EB]/30 cursor-pointer transition-colors"
    >
      <div className="flex gap-3">
        <div className="w-12 h-12 rounded-full bg-[#0A84FF] text-white flex items-center justify-center font-medium flex-shrink-0 overflow-hidden">
          {conversation.contactAvatar ? (
            <img
              src={conversation.contactAvatar}
              alt={`Foto de ${conversation.contactName}`}
              className="w-full h-full object-cover"
            />
          ) : (
            initials
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-medium text-[#1E1E1E] truncate">
              {conversation.contactName}
            </h3>
            <span className="text-xs text-gray-500 flex-shrink-0 ml-2">
              {getTimeAgo(conversation.lastTimestamp)}
            </span>
          </div>
          <p className="text-sm text-gray-600 truncate mb-2">
            {renderLastMessage()}
          </p>
          <div className="flex items-center gap-2 min-w-0 relative pr-10">
            <span
              className={`flex items-center gap-1 text-xs font-medium ${channelInfo.textColor} flex-shrink-0`}
            >
              {channelInfo.icon}
              {channelInfo.name}
            </span>
            {visibleTag ? renderTagPill(visibleTag) : null}
            {hiddenTagsCount > 0 ? (
              <CustomTooltip
                side="top"
                align="start"
                text={
                  <div className="flex max-w-[220px] flex-wrap gap-2">
                    {hiddenTags.map((tag) => renderTagPill(tag))}
                  </div>
                }
              >
                <span className="inline-flex flex-shrink-0 cursor-default rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  +{hiddenTagsCount}
                </span>
              </CustomTooltip>
            ) : null}

            {conversation.unreadCount > 0 && (
              <span className="absolute right-0 bg-[#0A84FF] text-white text-xs px-2 py-0.5 rounded-full">
                {conversation.unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
