import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient"; // Ajuste o caminho para o seu cliente do Supabase
import { toast } from "react-toastify";
import { useClinic } from "../contexts/ClinicContext";

export interface AvailableTag {
  id: string;
  name: string;
  color: string;
  clinic_id?: string;
}

export const useTags = () => {
  const [tags, setTags] = useState<AvailableTag[]>([]);
  const [loading, setLoading] = useState(false);
  const { clinicId } = useClinic();

  // Buscar etiquetas do banco
  const fetchTags = async () => {
    if (!clinicId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("tags")
        .select("id, name, color, clinic_id")
        .eq("clinic_id", clinicId)
        .order("name", { ascending: true });

      if (error) throw error;
      setTags(data || []);
    } catch (error: any) {
      console.error("Erro ao buscar etiquetas:", error);
      toast.error("Erro ao carregar etiquetas do banco.");
    } finally {
      setLoading(false);
    }
  };

  // Inserir nova etiqueta
  const createTag = async (name: string, color: string) => {
    try {
      const { data, error } = await supabase
        .from("tags")
        // Sem clinic_id o banco recusa a etiqueta (RLS)
        .insert([{ name, color, clinic_id: clinicId }])
        .select()
        .single();

      if (error) throw error;
      
      setTags(prev => [...prev, data]);
      return data;
    } catch (error: any) {
      throw new Error(error.message || "Erro ao criar etiqueta.");
    }
  };

  // Atualizar etiqueta existente
  const updateTag = async (id: string, name: string, color: string) => {
    try {
      const { error } = await supabase
        .from("tags")
        .update({ name, color })
        .eq("id", id);

      if (error) throw error;

      setTags(prev => prev.map(t => (t.id === id ? { ...t, name, color } : t)));
    } catch (error: any) {
      throw new Error(error.message || "Erro ao atualizar etiqueta.");
    }
  };

  // Deletar etiqueta
  const deleteTag = async (id: string) => {
    try {
      const { error } = await supabase
        .from("tags")
        .delete()
        .eq("id", id);

      if (error) throw error;

      setTags(prev => prev.filter(t => t.id !== id));
    } catch (error: any) {
      throw new Error(error.message || "Erro ao deletar etiqueta.");
    }
  };

  useEffect(() => {
    fetchTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId]);

  return { tags, loading, refreshTags: fetchTags, createTag, updateTag, deleteTag };
};