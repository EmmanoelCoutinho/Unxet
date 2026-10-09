import React, { useState } from "react";
import { 
  SendIcon, 
  UsersIcon, 
  TagIcon, 
  MessageSquareTextIcon, 
  AlertCircleIcon, 
  CheckCircle2Icon,
  RefreshCwIcon, 
  CheckCircleIcon, 
  XCircleIcon, 
  ClockIcon, 
  EyeIcon,
  Trash2Icon,
  BanIcon,
  PlusIcon,
  XIcon,
  PencilIcon
} from "lucide-react";
import { toast } from "react-toastify";
import { useMassMessages } from "../hooks/useMassMessages";
import { useCampaignStatus, Campaign, QueueItem } from "../hooks/useCampaignStatus";
import { useTags, AvailableTag } from "../hooks/useTags"; // Importando o novo hook

type TargetType = "all" | "tags";

export const MassMessagesPage: React.FC = () => {
  const [targetType, setTargetType] = useState<TargetType>("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [totalEnviados, setTotalEnviados] = useState(0);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Estados para o formulário de criação inline
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#3b82f6");

  // Estados para edição inline
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editTagName, setEditTagName] = useState("");
  const [editTagColor, setEditTagColor] = useState("#3b82f6");

  // Consumindo os Hooks de Backend
  const { triggerMassCampaign, loading: sending } = useMassMessages();
  const { tags: localTags, createTag, updateTag, deleteTag } = useTags();

  const handleTagToggle = (tagId: string) => {
    setSelectedTags(prev => 
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    );
  };

  // Handler para Criar no Supabase
  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) {
      toast.error("Insira um nome para a etiqueta.");
      return;
    }

    try {
      await createTag(newTagName.trim(), newTagColor);
      setNewTagName("");
      setIsCreatingTag(false);
      toast.success("Etiqueta salva no banco de dados!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao salvar etiqueta.");
    }
  };

  const startEditing = (tag: AvailableTag, e: React.MouseEvent) => {
    e.stopPropagation(); 
    setEditingTagId(tag.id);
    setEditTagName(tag.name);
    setEditTagColor(tag.color);
  };

  // Handler para Atualizar no Supabase
  const handleUpdateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTagName.trim()) {
      toast.error("O nome da etiqueta não pode estar vazio.");
      return;
    }

    try {
      if (!editingTagId) return;
      await updateTag(editingTagId, editTagName.trim(), editTagColor);
      setEditingTagId(null);
      toast.success("Etiqueta atualizada com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao atualizar.");
    }
  };

  // Handler para Deletar no Supabase
  const handleDeleteTag = async (tagId: string, e: React.MouseEvent) => {
    e.stopPropagation(); 
    if (!window.confirm("Deseja realmente deletar esta etiqueta do banco de dados?")) return;

    try {
      await deleteTag(tagId);
      setSelectedTags(prev => prev.filter(id => id !== tagId));
      toast.success("Etiqueta removida do banco de dados!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao remover etiqueta.");
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!message.trim()) {
      toast.error("Por favor, escreva uma mensagem para o disparo.");
      return;
    }

    if (targetType === "tags" && selectedTags.length === 0) {
      toast.error("Selecione pelo menos uma etiqueta.");
      return;
    }

    const selectedIds = targetType === "tags" ? selectedTags : [];

    try {
      const res = await triggerMassCampaign({
        targetType,
        selectedIds,
        messageTemplate: message,
      });

      if (res?.success) {
        setSuccess(true);
        setTotalEnviados(res.total);
        toast.success(`Campanha iniciada para ${res.total} contatos!`);
        setMessage("");
        setSelectedTags([]);
        setRefreshTrigger(prev => prev + 1);
      }
    } catch (error: any) {
      toast.error(error.message || "Falha ao iniciar campanha. Verifique os filtros.");
    }
  };

  return (
    <div className="p-4 sm:p-6 h-full overflow-y-auto bg-gray-50 w-full flex justify-center">
      <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* LADO ESQUERDO: Formulários e Configurações */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold text-gray-800">Mensagens em Massa</h1>
            <p className="text-sm text-gray-500">
              Envia notificações e alertas em lote filtrando por segmentos específicos.
            </p>
          </div>

          {success && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3 text-green-700 animate-fadeIn">
              <CheckCircle2Icon className="h-5 w-5 flex-shrink-0" />
              <div>
                <p className="font-semibold">Campanha disparada com sucesso!</p>
                <p className="text-sm opacity-90">
                  A fila com {totalEnviados} contato(s) foi gerada e os envios estão sendo processados em segundo plano.
                </p>
              </div>
              <button 
                type="button"
                onClick={() => setSuccess(false)} 
                className="ml-auto text-sm font-semibold hover:underline flex-shrink-0"
              >
                Novo disparo
              </button>
            </div>
          )}

          <form onSubmit={handleSend} className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <div className="space-y-4">
              <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                  <UsersIcon className="h-4 w-4 text-blue-500" />
                  1. Destinatários
                </h3>
                
                <div className="space-y-3">
                  <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    targetType === "all" ? "border-blue-500 bg-blue-50/40" : "border-gray-200 hover:bg-gray-50"
                  }`}>
                    <div className="relative flex items-center justify-center">
                      <input 
                        type="radio" 
                        name="target" 
                        checked={targetType === "all"} 
                        onChange={() => setTargetType("all")}
                        className="peer appearance-none h-5 w-5 rounded-full border-2 border-gray-300 checked:border-blue-600 transition-all cursor-pointer"
                      />
                      <div className="absolute h-2.5 w-2.5 rounded-full bg-blue-600 scale-0 peer-checked:scale-100 transition-transform" />
                    </div>
                    <span className={`text-sm font-medium ${targetType === "all" ? "text-blue-900" : "text-gray-700"}`}>
                      Todos os contatos
                    </span>
                  </label>

                  <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    targetType === "tags" ? "border-blue-500 bg-blue-50/40" : "border-gray-200 hover:bg-gray-50"
                  }`}>
                    <div className="relative flex items-center justify-center">
                      <input 
                        type="radio" 
                        name="target" 
                        checked={targetType === "tags"} 
                        onChange={() => setTargetType("tags")}
                        className="peer appearance-none h-5 w-5 rounded-full border-2 border-gray-300 checked:border-blue-600 transition-all cursor-pointer"
                      />
                      <div className="absolute h-2.5 w-2.5 rounded-full bg-blue-600 scale-0 peer-checked:scale-100 transition-transform" />
                    </div>
                    <span className={`text-sm font-medium ${targetType === "tags" ? "text-blue-900" : "text-gray-700"}`}>
                      Filtrar por Etiquetas
                    </span>
                  </label>
                </div>
              </div>

              {/* Filtros por Etiquetas */}
              {targetType === "tags" && (
                <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm border-t-2 border-t-blue-500 animate-fadeIn space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                      <TagIcon className="h-3 w-3" /> Selecionar Etiquetas
                    </h3>
                    
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreatingTag(!isCreatingTag);
                        setEditingTagId(null);
                      }}
                      className="p-1 hover:bg-blue-50 text-blue-600 rounded-full border border-blue-200 transition-colors"
                      title="Adicionar Etiqueta Personalizada"
                    >
                      {isCreatingTag ? <XIcon className="h-3.5 w-3.5" /> : <PlusIcon className="h-3.5 w-3.5" />}
                    </button>
                  </div>

                  {/* Criação inline de Etiqueta */}
                  {isCreatingTag && (
                    <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-3 animate-fadeIn">
                      <p className="text-xs font-semibold text-gray-600">Nova etiqueta</p>
                      <div className="flex items-center gap-2">
                        <div className="relative w-7 h-7 rounded-full overflow-hidden border border-gray-300 flex-shrink-0 shadow-sm" style={{ backgroundColor: newTagColor }}>
                          <input 
                            type="color" 
                            value={newTagColor}
                            onChange={(e) => setNewTagColor(e.target.value)}
                            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer scale-150"
                          />
                        </div>
                        <input 
                          type="text" 
                          placeholder="Nome da etiqueta..."
                          value={newTagName}
                          onChange={(e) => setNewTagName(e.target.value)}
                          className="flex-1 px-2.5 py-1 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        />
                        <button
                          type="button"
                          onClick={handleCreateTag}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors"
                        >
                          Salvar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Edição inline de Etiqueta */}
                  {editingTagId && (
                    <div className="p-3 bg-amber-50/50 border border-amber-200 rounded-xl space-y-3 animate-fadeIn">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-amber-800">Editar etiqueta</p>
                        <button type="button" onClick={() => setEditingTagId(null)}>
                          <XIcon className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="relative w-7 h-7 rounded-full overflow-hidden border border-gray-300 flex-shrink-0 shadow-sm" style={{ backgroundColor: editTagColor }}>
                          <input 
                            type="color" 
                            value={editTagColor}
                            onChange={(e) => setEditTagColor(e.target.value)}
                            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer scale-150"
                          />
                        </div>
                        <input 
                          type="text" 
                          value={editTagName}
                          onChange={(e) => setEditTagName(e.target.value)}
                          className="flex-1 px-2.5 py-1 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                        />
                        <button
                          type="button"
                          onClick={handleUpdateTag}
                          className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium rounded-lg transition-colors"
                        >
                          Atualizar
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {localTags.length === 0 ? (
                      <p className="text-xs text-gray-400 p-2 italic text-center">Nenhuma etiqueta. Clique no "+" para criar.</p>
                    ) : (
                      localTags.map(tag => {
                        const isTagSelected = selectedTags.includes(tag.id);
                        return (
                          <div
                            key={tag.id}
                            onClick={() => handleTagToggle(tag.id)}
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all text-sm font-medium cursor-pointer ${
                              isTagSelected ? 'bg-blue-50/20 border-blue-200 text-blue-900' : 'border-transparent text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex items-center gap-3 truncate mr-2">
                              <div className="relative flex items-center justify-center flex-shrink-0">
                                <input 
                                  type="checkbox"
                                  checked={isTagSelected}
                                  readOnly
                                  className="peer appearance-none h-5 w-5 rounded-md border-2 border-gray-300 checked:bg-blue-600 checked:border-blue-600 transition-all cursor-pointer focus:outline-none"
                                />
                                <svg className="absolute w-3.5 h-3.5 text-white pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                              <span className="h-2.5 w-2.5 rounded-full flex-shrink-0 border border-black/10" style={{ backgroundColor: tag.color }} />
                              <span className="truncate">{tag.name}</span>
                            </div>

                            <div className="flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={(e) => startEditing(tag, e)}
                                className="p-1 hover:bg-gray-200 rounded text-gray-500 hover:text-amber-600"
                                title="Editar etiqueta"
                              >
                                <PencilIcon className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleDeleteTag(tag.id, e)}
                                className="p-1 hover:bg-gray-200 rounded text-gray-500 hover:text-red-600"
                                title="Deletar etiqueta"
                              >
                                <Trash2Icon className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Conteúdo da Mensagem */}
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col h-full justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <MessageSquareTextIcon className="h-4 w-4 text-blue-500" />
                  2. Conteúdo da Mensagem
                </h3>

                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Escreva aqui o texto da mensagem em massa..."
                  rows={6}
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-sm placeholder-gray-400 focus:outline-none"
                />

                <div className="mt-2 flex gap-2">
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                    Dica: Use <code className="font-bold">{"{nome}"}</code> para saudar o cliente.
                  </span>
                </div>
              </div>

              <div className="mt-4">
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex gap-3 text-amber-800 text-xs">
                  <AlertCircleIcon className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <p>
                    <strong>Aviso:</strong> Disparos frequentes sem interação prévia podem causar o banimento do número. Intervalos automáticos são gerenciados pelo backend.
                  </p>
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="submit"
                    disabled={sending}
                    className={`w-full md:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg shadow-sm transition-colors ${
                      sending ? "opacity-60 cursor-not-allowed" : ""
                    }`}
                  >
                    <SendIcon className="h-4 w-4" />
                    {sending ? "Disparando..." : "Iniciar Disparo"}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>

        {/* LADO DIREITO: Histórico de Disparos */}
        <div className="lg:col-span-1 h-full">
          <CampaignHistory key={refreshTrigger} />
        </div>

      </div>
    </div>
  );
};

/* ==========================================================================
    COMPONENTE SECUNDÁRIO: HISTÓRICO DE DISPAROS
   ========================================================================== */
interface CampaignHistoryProps {
  key?: number;
}

const CampaignHistory: React.FC<CampaignHistoryProps> = () => {
  const { campaigns, loading, refresh, getCampaignDetails, cancelCampaign, deleteCampaign } = useCampaignStatus();
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [details, setDetails] = useState<QueueItem[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleViewDetails = async (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setLoadingDetails(true);
    try {
      const data = await getCampaignDetails(campaign.id);
      setDetails(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleCancel = async (campaignId: string) => {
    if (!window.confirm("Tens a certeza que desejas cancelar esta campanha?")) return;
    setActionLoading(campaignId);
    try {
      await cancelCampaign(campaignId);
      toast.success("Campanha cancelada!");
      refresh();
    } catch (err) {
      toast.error("Falha ao cancelar.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (campaignId: string) => {
    if (!window.confirm("Tens a certeza que desejas apagar o histórico?")) return;
    setActionLoading(campaignId);
    try {
      await deleteCampaign(campaignId);
      toast.success("Histórico removido!");
      refresh();
    } catch (err) {
      toast.error("Falha ao apagar.");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm w-full flex flex-col h-[calc(100vh-120px)] min-h-[500px] animate-fadeIn">
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h3 className="text-base font-bold text-gray-800">Histórico de Disparos</h3>
          <p className="text-xs text-gray-500">Acompanhe as entregas em lote.</p>
        </div>
        <button 
          type="button"
          onClick={refresh} 
          disabled={loading}
          className="p-2 hover:bg-gray-100 rounded-lg border transition-colors text-gray-600 disabled:opacity-50"
        >
          <RefreshCwIcon className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="overflow-y-auto flex-1 space-y-3 pr-1">
        {campaigns.length === 0 && !loading ? (
          <p className="text-sm text-gray-400 text-center py-6 sm:py-8 italic">Nenhum disparo realizado.</p>
        ) : (
          campaigns.map((camp) => (
            <div key={camp.id} className="p-4 rounded-xl border border-gray-100 hover:border-gray-200 bg-gray-50/30 space-y-3 transition-all">
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs text-gray-400">
                  {new Date(camp.created_at).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" })}
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                  camp.status === "completed" ? "bg-green-50 text-green-700" :
                  camp.status === "processing" ? "bg-blue-50 text-blue-700 animate-pulse" :
                  camp.status === "cancelled" ? "bg-gray-100 text-gray-600" : "bg-amber-50 text-amber-700"
                }`}>
                  {camp.status}
                </span>
              </div>

              <div className="text-sm text-gray-700 line-clamp-2 font-medium">
                {camp.message}
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-gray-100 text-xs">
                <span className="font-semibold text-blue-600 uppercase text-[10px] bg-blue-50 px-2 py-0.5 rounded">
                  {camp.target_type}
                </span>
                
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-gray-200 h-1 rounded-full overflow-hidden">
                    <div 
                      className="bg-blue-600 h-full transition-all" 
                      style={{ width: `${camp.total_targets > 0 ? ((camp.sent_count || 0) / camp.total_targets) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-mono font-bold text-gray-600">
                    {camp.sent_count}/{camp.total_targets}
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-1 pt-1">
                <button 
                  type="button"
                  onClick={() => handleViewDetails(camp)}
                  disabled={actionLoading === camp.id}
                  className="p-1.5 hover:bg-blue-50 text-blue-600 rounded-md inline-flex items-center gap-1 text-xs"
                >
                  <EyeIcon className="h-3.5 w-3.5" />
                </button>

                {(camp.status === "pending" || camp.status === "processing") && (
                  <button 
                    type="button"
                    onClick={() => handleCancel(camp.id)}
                    disabled={actionLoading === camp.id}
                    className="p-1.5 hover:bg-amber-50 text-amber-600 rounded-md inline-flex items-center gap-1 text-xs"
                  >
                    <BanIcon className="h-3.5 w-3.5" />
                  </button>
                )}

                <button 
                  type="button"
                  onClick={() => handleDelete(camp.id)}
                  disabled={actionLoading === camp.id}
                  className="p-1.5 hover:bg-red-50 text-red-500 rounded-md inline-flex items-center gap-1 text-xs"
                >
                  <Trash2Icon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Relatório Drawer */}
      {selectedCampaign && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex justify-end z-50 animate-fadeIn">
          <div className="bg-white w-full max-w-md h-full p-4 sm:p-6 shadow-xl flex flex-col justify-between">
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between border-b pb-3 mb-4">
                <h4 className="font-bold text-gray-800 text-lg">Relatório de Entrega</h4>
                <button type="button" onClick={() => setSelectedCampaign(null)} className="text-gray-400 hover:text-gray-600 font-bold text-xl">✕</button>
              </div>
              
              <div className="text-xs bg-gray-50 p-3 rounded-lg border mb-4 text-gray-600">
                <p><strong>Mensagem Original:</strong></p>
                <p className="italic mt-1 line-clamp-3">"{selectedCampaign.message}"</p>
              </div>

              <h5 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Destinatários individuais</h5>
              
              <div className="space-y-2 overflow-y-auto flex-1 pr-1 max-h-[calc(100vh-250px)]">
                {loadingDetails ? (
                  <p className="text-sm text-gray-400 text-center py-4">Carregando números...</p>
                ) : (
                  details.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-2.5 rounded-lg border border-gray-100 text-sm">
                      <span className="font-mono text-gray-700">{item.phone_text}</span>
                      <div className="flex items-center gap-2">
                        {item.status === "sent" && (
                          <span className="text-green-600 flex items-center gap-1 text-xs bg-green-50 px-2 py-0.5 rounded-full font-medium">
                            <CheckCircleIcon className="h-3 w-3" /> Enviado
                          </span>
                        )}
                        {item.status === "failed" && (
                          <span className="text-red-600 flex items-center gap-1 text-xs bg-red-50 px-2 py-0.5 rounded-full font-medium">
                            <XCircleIcon className="h-3 w-3" /> Falhou
                          </span>
                        )}
                        {item.status === "pending" && (
                          <span className="text-amber-600 flex items-center gap-1 text-xs bg-amber-50 px-2 py-0.5 rounded-full font-medium">
                            <ClockIcon className="h-3 w-3 animate-spin" /> Na Fila
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};