/**
 * Nome do atendente nas mensagens enviadas pelo app.
 *
 * O cliente recebe:
 *   *Maria:*
 *   Olá, tudo bem?
 *
 * No WhatsApp o nome vai em negrito (*...*). Instagram e Messenger não têm
 * formatação, então lá vai sem os asteriscos e com uma linha em branco entre
 * o nome e a mensagem (sem o negrito, ficava tudo grudado). O texto guardado no banco fica
 * sem o nome (a tela mostra o nome acima do balão, por messages.sender_name).
 */

const MAX_NAME_LENGTH = 60;

/** Nome limpo para a assinatura: sem quebras de linha nem símbolos de formatação. */
export function cleanAgentName(raw: unknown): string {
  const name = String(raw ?? "")
    // *negrito* _itálico_ ~riscado~ `código` quebrariam o negrito da assinatura
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH).trim() : name;
}

/** "*Maria:*" (WhatsApp) ou "Maria:" (Instagram/Messenger). Vazio sem nome. */
export function agentSignature(name: unknown, opts: { bold: boolean }): string {
  const clean = cleanAgentName(name);
  if (!clean) return "";
  return opts.bold ? `*${clean}:*` : `${clean}:`;
}

/**
 * Texto (ou legenda) com o nome do atendente na primeira linha.
 * Sem nome, devolve o texto como veio; sem texto, só a assinatura.
 */
export function signText(text: unknown, name: unknown, opts: { bold: boolean }): string {
  const body = String(text ?? "");
  const signature = agentSignature(name, opts);
  if (!signature) return body;
  if (!body.trim()) return signature;
  return opts.bold ? `${signature}\n${body}` : `${signature}\n\n${body}`;
}

export type AgentSender = {
  userId: string;
  // Nome exibido no app (null se a pessoa não tem nome cadastrado)
  name: string | null;
  // A empresa quer o nome na mensagem enviada ao cliente?
  sign: boolean;
};

/**
 * Quem está enviando e se a empresa assina as mensagens
 * (conversation_automation_settings.sign_agent_messages, ligado por padrão).
 * Erro de leitura não impede o envio: segue sem assinatura.
 */
export async function loadAgentSender(admin, userId: string, clinicId: string): Promise<AgentSender> {
  const [memberRes, settingsRes] = await Promise.all([
    admin.from("clinic_users").select("name").eq("clinic_id", clinicId).eq("user_id", userId).maybeSingle(),
    admin.from("conversation_automation_settings").select("sign_agent_messages").eq("clinic_id", clinicId).maybeSingle(),
  ]);
  if (memberRes.error) console.error("agent_sender.member_failed", memberRes.error);
  if (settingsRes.error) console.error("agent_sender.settings_failed", settingsRes.error);

  const name = cleanAgentName(memberRes.data?.name) || null;
  const sign = !settingsRes.error && settingsRes.data?.sign_agent_messages !== false;
  return { userId, name, sign: sign && !!name };
}
