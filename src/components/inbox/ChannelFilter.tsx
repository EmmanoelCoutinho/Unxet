import React from 'react';
import { MessageCircleIcon, InstagramIcon, FacebookIcon } from 'lucide-react';
import { Channel } from '../../types';
interface ChannelFilterProps {
  selectedChannels: Channel[];
  onChange: (channels: Channel[]) => void;
}
export const ChannelFilter: React.FC<ChannelFilterProps> = ({
  selectedChannels,
  onChange
}) => {
  const channels: {
    value: Channel;
    label: string;
    icon: React.ReactNode;
  }[] = [{
    value: 'whatsapp',
    label: 'WhatsApp',
    icon: <MessageCircleIcon className="w-4 h-4" />
  }, {
    value: 'instagram',
    label: 'Instagram',
    icon: <InstagramIcon className="w-4 h-4" />
  }, {
    value: 'messenger',
    label: 'Messenger',
    icon: <FacebookIcon className="w-4 h-4" />
  }];
  const toggleChannel = (channel: Channel) => {
    if (selectedChannels.includes(channel)) {
      onChange(selectedChannels.filter(c => c !== channel));
    } else {
      onChange([...selectedChannels, channel]);
    }
  };
  return <div className="mb-3">
      <label className="text-xs font-medium text-gray-600 mb-2 block">
        Canais
      </label>
      <div className="flex flex-wrap gap-2">
        {channels.map(channel => <button key={channel.value} onClick={() => toggleChannel(channel.value)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${selectedChannels.includes(channel.value) ? 'bg-[#0A84FF] text-white' : 'bg-[#E5E7EB] text-[#1E1E1E] hover:bg-[#E5E7EB]/70'}`}>
            {channel.icon}
            <span>{channel.label}</span>
          </button>)}
      </div>
    </div>;
};