// Permissões que um cargo personalizado pode ter. Mesma lista de
// public.clinic_permission_catalog() (migration 20261109000000_custom_roles):
// adicionar uma permissão nova exige mudar os dois lugares.

export type Permission =
  | "conversations.all"
  | "dashboard.view"
  | "quick_messages.manage"
  | "tags.manage"
  | "file_library.manage"
  | "contacts.view"
  | "leads.all"
  | "campaigns.all"
  | "meta_templates.create"
  | "bots.manage"
  | "ai.manage"
  | "reports.view";

export type PermissionGroup = "Atendimento" | "Vendas e marketing" | "Automação" | "Gestão";

export type PermissionInfo = {
  key: Permission;
  group: PermissionGroup;
  label: string;
  description: string;
};

export const PERMISSIONS: PermissionInfo[] = [
  {
    key: "conversations.all",
    group: "Atendimento",
    label: "Todas as conversas",
    description: "Vê e atende conversas de todos os departamentos, como o administrador.",
  },
  {
    key: "dashboard.view",
    group: "Atendimento",
    label: "Painel",
    description: "Vê o Painel com a fila e a equipe em tempo real.",
  },
  {
    key: "quick_messages.manage",
    group: "Atendimento",
    label: "Gerenciar mensagens rápidas",
    description: "Cria, edita e apaga mensagens rápidas. Sem isso, só usa.",
  },
  {
    key: "tags.manage",
    group: "Atendimento",
    label: "Gerenciar etiquetas",
    description: "Cria, edita e apaga etiquetas. Sem isso, só aplica nas conversas.",
  },
  {
    key: "file_library.manage",
    group: "Atendimento",
    label: "Gerenciar banco de arquivos",
    description: "Adiciona, edita e apaga arquivos da biblioteca. Sem isso, só envia nas conversas.",
  },
  {
    key: "contacts.view",
    group: "Vendas e marketing",
    label: "Carteira de clientes",
    description: "Abre a Carteira de clientes.",
  },
  {
    key: "leads.all",
    group: "Vendas e marketing",
    label: "Funil de toda a equipe",
    description: "Vê, passa para outra pessoa e apaga negociações de todos. Sem isso, só as próprias.",
  },
  {
    key: "campaigns.all",
    group: "Vendas e marketing",
    label: "Campanhas de toda a equipe",
    description: "Vê e edita campanhas criadas por outras pessoas. Sem isso, só as próprias.",
  },
  {
    key: "meta_templates.create",
    group: "Vendas e marketing",
    label: "Criar modelos da Meta",
    description: "Envia modelos de mensagem para a Meta aprovar.",
  },
  {
    key: "bots.manage",
    group: "Automação",
    label: "Bots",
    description: "Cria e edita os bots de atendimento.",
  },
  {
    key: "ai.manage",
    group: "Automação",
    label: "Assistente com IA",
    description: "Edita o que a IA sabe sobre a empresa e vê o consumo do mês.",
  },
  {
    key: "reports.view",
    group: "Gestão",
    label: "Relatórios",
    description: "Vê os relatórios do período e exporta.",
  },
];

export const PERMISSION_GROUPS: PermissionGroup[] = [
  "Atendimento",
  "Vendas e marketing",
  "Automação",
  "Gestão",
];

/** O que o Atendente (cargo padrão) já pode. Igual a clinic_agent_default_permissions(). */
export const AGENT_DEFAULT_PERMISSIONS: Permission[] = ["meta_templates.create"];

/** Só o administrador: não entra em nenhum cargo personalizado. */
export const ADMIN_ONLY_AREAS = [
  "Atendentes e cargos",
  "Departamentos",
  "Configurações e integrações",
];

const KNOWN = new Set<string>(PERMISSIONS.map((p) => p.key));
export const isPermission = (value: string): value is Permission => KNOWN.has(value);

/**
 * Permissões de quem está logado. Administrador tem todas; atendente sem cargo
 * tem as do Atendente; com cargo, as do cargo (o que não está no catálogo é
 * ignorado).
 */
export const resolvePermissions = (
  role: string | null | undefined,
  rolePermissions: string[] | null | undefined,
): Set<Permission> => {
  if (role === "admin") return new Set(PERMISSIONS.map((p) => p.key));
  if (!rolePermissions) return new Set(AGENT_DEFAULT_PERMISSIONS);
  return new Set(rolePermissions.filter(isPermission));
};
