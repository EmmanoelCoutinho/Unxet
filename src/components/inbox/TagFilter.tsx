import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { useNavigate } from "react-router-dom";

interface TagFilterProps {
  selectedTagIds: string[];
  onChange: (tagIds: string[]) => void;
}

type TagOption = {
  id: string;
  name: string;
  color: string;
};

type DbTagRow = {
  id: string;
  name: string | null;
  color: string | null;
  clinic_id: string | null;
};

export const TagFilter: React.FC<TagFilterProps> = ({ selectedTagIds = [], onChange }) => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const clinicId = profile?.clinic_id ?? null;

  const [tags, setTags] = useState<TagOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const hasNoTags = useMemo(
    () => !isLoading && tags.length === 0,
    [isLoading, tags.length]
  );

  const fetchTags = useCallback(async () => {
    if (!clinicId) return;

    setIsLoading(true);

    const { data, error } = await supabase
      .from("tags")
      .select("id,name,color,clinic_id")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false });

    if (error) {
      setTags([]);
      setIsLoading(false);
      return;
    }

    const mapped: TagOption[] = (data as DbTagRow[])
      .map((row) => ({
        id: row.id,
        name: (row.name ?? "").trim(),
        color: (row.color ?? "#0A84FF").trim(),
      }))
      .filter((t) => Boolean(t.id) && Boolean(t.name));

    setTags(mapped);
    setIsLoading(false);
  }, [clinicId]);

  useEffect(() => {
    if (!clinicId) return;

    // carrega inicial
    fetchTags();

    const channel = supabase
      .channel(`realtime:tags:${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tags",
          filter: `clinic_id=eq.${clinicId}`,
        },
        () => {
          // sempre que criar/editar/excluir, recarrega
          fetchTags();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinicId, fetchTags]);

  const toggleTag = (tagId: string) => {
    const current = selectedTagIds ?? [];
    if (current.includes(tagId)) {
      onChange(current.filter((id) => id !== tagId));
    } else {
      onChange([...current, tagId]);
    }
  };


  return (
    <div>
      <label className="text-xs font-medium text-gray-600 mb-2 block">
        Etiquetas
      </label>

      {!clinicId ? (
        <div className="text-xs text-gray-500">Carregando empresa...</div>
      ) : isLoading ? (
        <div className="text-xs text-gray-500">Carregando tags...</div>
      ) : hasNoTags ? (
        <div className="text-xs text-gray-500">
          Para criar novas tags acesse a página{" "}
          <span
            onClick={() => navigate("/inbox/tags")}
            className="font-medium italic cursor-pointer text-blue-500"
          >
            Etiquetas
          </span>
          .
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => {
            const isSelected = selectedTagIds.includes(tag.id);

            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                className={`transition-opacity ${
                  isSelected ? "opacity-100" : "opacity-50 hover:opacity-75"
                }`}
              >
                <span
                  className="inline-flex rounded-full px-3 py-1 text-xs font-medium text-white select-none"
                  style={{ backgroundColor: tag.color }}
                >
                  {tag.name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
