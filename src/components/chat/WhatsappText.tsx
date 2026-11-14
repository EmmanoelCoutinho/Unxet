import React from "react";
import {
  parseWhatsappFormatting,
  type WhatsappNode,
} from "../../lib/whatsappFormatting";

const renderNodes = (nodes: WhatsappNode[]): React.ReactNode[] =>
  nodes.map((node, index) => {
    if (typeof node === "string") return node;
    const children = renderNodes(node.children);
    switch (node.style) {
      case "bold":
        return <strong key={index} className="font-semibold">{children}</strong>;
      case "italic":
        return <em key={index}>{children}</em>;
      case "strike":
        return <s key={index}>{children}</s>;
      case "mono":
        return <code key={index} className="font-mono text-[0.95em]">{children}</code>;
      default:
        return children;
    }
  });

/** Texto de mensagem com a formatação do WhatsApp (*negrito*, _itálico_...). */
export const WhatsappText: React.FC<{ text: string }> = ({ text }) => (
  <>{renderNodes(parseWhatsappFormatting(text))}</>
);
