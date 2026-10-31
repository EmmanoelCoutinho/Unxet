// Monta o que a IA do bot recebe: as instruções (base da Unxet + empresa +
// etapa) e o histórico da conversa. Sem chamadas de rede, para dar para testar.

export type AiSettings = {
  assistant_name?: string | null;
  tone?: string | null;
  use_emojis?: boolean | null;
  business_info?: string | null;
  faq?: string | null;
  rules?: string | null;
  custom_instructions?: string | null;
};

export type AiNode = {
  ai_instructions?: string | null;
};

export type HistoryMessage = {
  direction: string;
  type?: string | null;
  text?: string | null;
  transcript_text?: string | null;
  created_at?: string | null;
};

export type ChatTurn = { role: "user" | "assistant"; content: string };

export const AI_TOOL_TRANSFER = "transferir_para_atendente";
export const AI_TOOL_END = "encerrar_conversa";

// Camada 1: igual para todas as empresas
const BASE_PROMPT = `Você atende clientes de uma empresa pelo WhatsApp, em nome dela. As informações da empresa e do atendimento estão abaixo.

Como responder:
- Escreva em português do Brasil, como uma pessoa da equipe escreveria no WhatsApp: mensagens curtas, uma ideia por vez, sem textos longos.
- Formatação do WhatsApp apenas: *negrito* com um asterisco, listas simples com hífen. Nada de títulos, tabelas ou links em markdown.
- Use somente as informações da empresa que estão aqui. Se não souber algo (preço, prazo, disponibilidade, situação de um pedido), não invente: diga que vai verificar com a equipe e transfira.
- Nunca prometa o que não está nas informações da empresa, como descontos, prazos ou exceções.
- Não fale de assuntos que não têm relação com a empresa. Responda com educação e volte ao atendimento.
- Não peça dados sensíveis como senhas ou número de cartão.
- Não diga que é uma IA a menos que o cliente pergunte. Se perguntar, confirme que é o assistente virtual da empresa.

Quando passar para a equipe (ferramenta ${AI_TOOL_TRANSFER}):
- o cliente pede para falar com uma pessoa;
- a dúvida precisa de algo que você não sabe ou não pode fazer;
- o cliente está irritado ou reclamando;
- o objetivo desta etapa foi concluído e o próximo passo é com a equipe.
Antes de transferir, escreva uma frase curta avisando o cliente.

Quando encerrar (ferramenta ${AI_TOOL_END}): o cliente se despediu ou disse que não precisa de mais nada. Escreva uma despedida curta antes.

Mensagens entre colchetes, como [áudio] ou [foto], são arquivos que o cliente mandou e você não consegue ver. Se o conteúdo for importante, peça para o cliente escrever ou transfira.`;

const section = (title: string, body: string | null | undefined) => {
  const text = String(body ?? "").trim();
  return text ? `## ${title}\n${text}` : "";
};

export const buildSystemPrompt = (params: {
  companyName: string;
  settings: AiSettings | null;
  node: AiNode;
  departmentName?: string | null;
}) => {
  const { companyName, settings, node, departmentName } = params;
  const s = settings ?? {};
  const name = String(s.assistant_name ?? "").trim() || "Assistente";
  const tone =
    s.tone === "formal"
      ? "Formal: trate o cliente por senhor ou senhora, sem gírias."
      : "Simpático e próximo, mas profissional. Trate o cliente por você.";
  const emojis = s.use_emojis
    ? "Pode usar emojis com moderação."
    : "Não use emojis.";

  const company = [
    `## Empresa\nVocê se chama ${name} e atende pela empresa ${companyName.trim() || "contratante"}.`,
    `## Tom de voz\n${tone} ${emojis}`,
    section("Sobre a empresa", s.business_info),
    section("Perguntas frequentes", s.faq),
    section("Regras da empresa", s.rules),
    // Plano sob medida: escrito pela Unxet
    section("Instruções adicionais", s.custom_instructions),
  ]
    .filter(Boolean)
    .join("\n\n");

  const step = [
    section("Objetivo desta etapa do atendimento", node.ai_instructions),
    departmentName
      ? `## Transferência\nAo transferir, a conversa vai para o setor ${departmentName}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [BASE_PROMPT, company, step].filter(Boolean).join("\n\n");
};

const MEDIA_LABELS: Record<string, string> = {
  audio: "áudio",
  image: "foto",
  video: "vídeo",
  document: "documento",
  sticker: "figurinha",
  location: "localização",
  contacts: "contato",
};

export const messageToText = (msg: HistoryMessage) => {
  const text = String(msg.text ?? "").trim();
  const type = String(msg.type ?? "text");
  if (type === "audio") {
    const transcript = String(msg.transcript_text ?? "").trim();
    return transcript ? `[áudio] ${transcript}` : "[áudio]";
  }
  if (type in MEDIA_LABELS) {
    const label = `[${MEDIA_LABELS[type]}]`;
    return text ? `${label} ${text}` : label;
  }
  return text || `[${type}]`;
};

// Histórico no formato da API: alterna cliente/assistente, começa pelo cliente
// e junta mensagens seguidas do mesmo lado.
export const buildChatTurns = (messages: HistoryMessage[]): ChatTurn[] => {
  const turns: ChatTurn[] = [];
  for (const msg of messages) {
    const role = msg.direction === "inbound" ? "user" : "assistant";
    const content = messageToText(msg);
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n${content}`;
    } else {
      turns.push({ role, content });
    }
  }
  if (turns[0]?.role === "assistant") {
    turns.unshift({ role: "user", content: "[o cliente iniciou a conversa]" });
  }
  // A IA responde ao cliente: a última fala precisa ser dele
  if (turns.length > 0 && turns[turns.length - 1].role === "assistant") {
    turns.push({ role: "user", content: "[o cliente aguarda a resposta]" });
  }
  return turns;
};
