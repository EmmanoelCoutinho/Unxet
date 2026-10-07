import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

const MIN_PASSWORD_LENGTH = 8;

export const ProfileModal: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const { authUser, profile, refreshProfile } = useAuth();

  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(profile?.name ?? "");
    setPassword("");
    setConfirmPassword("");
    setPasswordError(null);
  }, [open, profile?.name]);

  if (!open) return null;

  const trimmedName = name.trim();
  const canSaveName =
    !!authUser && trimmedName.length > 0 && trimmedName !== (profile?.name ?? "");

  const handleSaveName = async () => {
    if (!authUser || !canSaveName) return;

    setSavingName(true);
    const { error } = await supabase
      .from("clinic_users")
      .update({ name: trimmedName })
      .eq("user_id", authUser.id);
    setSavingName(false);

    if (error) {
      console.error("Erro ao atualizar nome:", error);
      toast.error("Não foi possível atualizar o nome.");
      return;
    }

    await refreshProfile();
    toast.success("Nome atualizado.");
  };

  const handleChangePassword = async () => {
    setPasswordError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(
        `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`,
      );
      return;
    }

    if (password !== confirmPassword) {
      setPasswordError("As senhas não conferem.");
      return;
    }

    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSavingPassword(false);

    if (error) {
      console.error("Erro ao alterar senha:", error);
      setPasswordError(
        error.message?.toLowerCase().includes("different")
          ? "A nova senha deve ser diferente da atual."
          : "Não foi possível alterar a senha.",
      );
      return;
    }

    setPassword("");
    setConfirmPassword("");
    toast.success("Senha alterada.");
  };

  return (
    <div className="fixed inset-0 z-[9999]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="border-b border-gray-200 p-5">
          <h3 className="text-base font-semibold text-gray-900">Meu perfil</h3>
          <p className="mt-1 text-sm text-gray-500">{authUser?.email}</p>
        </div>

        <div className="space-y-6 p-5">
          <section className="space-y-3">
            <Input
              label="Nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={handleSaveName}
                isLoading={savingName}
                disabled={!canSaveName}
              >
                Salvar nome
              </Button>
            </div>
          </section>

          <section className="space-y-3 border-t border-gray-200 pt-5">
            <h4 className="text-sm font-semibold text-gray-900">
              Alterar senha
            </h4>
            <Input
              label="Nova senha"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Input
              label="Confirmar nova senha"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              error={passwordError ?? undefined}
            />
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={handleChangePassword}
                isLoading={savingPassword}
                disabled={!password || !confirmPassword}
              >
                Alterar senha
              </Button>
            </div>
          </section>
        </div>

        <div className="flex justify-end border-t border-gray-200 p-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
};
