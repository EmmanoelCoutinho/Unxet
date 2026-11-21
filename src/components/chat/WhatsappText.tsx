import React from "react";
import {
  parseWhatsappFormatting,
  type WhatsappNode,
} from "../../lib/whatsappFormatting";
import { splitLinks } from "../../lib/messageLinks";

/** Texto com os links clicáveis (abrem em outra aba). */
const renderLinks = (text: string, keyPrefix: string): React.ReactNode => {
  const segments = splitLinks(text);
  if (!segments.some((s) => s.kind === "link")) return text;
  return segments.map((segment, index) =>
    segment.kind === "link" ? (
      <a
        key={`${keyPrefix}-${index}`}
        href={segment.href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all underline underline-offset-2 hover:opacity-80"
        // Clique no link não abre o menu nem a prévia do balão
        onClick={(event) => event.stopPropagation()}
      >
        {segment.value}
      </a>
    ) : (
      <React.Fragment key={`${keyPrefix}-${index}`}>{segment.value}</React.Fragment>
    ),
  );
};

const renderNodes = (nodes: WhatsappNode[], keyPrefix = "n"): React.ReactNode[] =>
  nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (typeof node === "string") {
      return <React.Fragment key={key}>{renderLinks(node, key)}</React.Fragment>;
    }
    // Monoespaçado fica como está (código, sem link)
    if (node.style === "mono") {
      return (
        <code key={key} className="font-mono text-[0.95em]">
          {node.children.map((child) => (typeof child === "string" ? child : "")).join("")}
        </code>
      );
    }
    const children = renderNodes(node.children, key);
    switch (node.style) {
      case "bold":
        return <strong key={key} className="font-semibold">{children}</strong>;
      case "italic":
        return <em key={key}>{children}</em>;
      case "strike":
        return <s key={key}>{children}</s>;
      default:
        return <React.Fragment key={key}>{children}</React.Fragment>;
    }
  });

/** Texto de mensagem com a formatação do WhatsApp (*negrito*, _itálico_...) e links. */
export const WhatsappText: React.FC<{ text: string }> = ({ text }) => (
  <>{renderNodes(parseWhatsappFormatting(text))}</>
);
