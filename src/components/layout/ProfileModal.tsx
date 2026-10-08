import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

export const ProfileModal: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const { authUser, profile, refreshProfile, sendPasswordResetEmail } =
    useAuth();

  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [sendingReset, setSendingReset] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(profile?.name ?? "");
    setResetSent(false);
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

  // A troca de senha usa o mesmo fluxo do "Esqueci a senha": um link enviado
  // ao e-mail do usuário, para que só quem tem acesso ao e-mail possa trocá-la.
  const handleSendPasswordReset = async () => {
    if (!authUser?.email) return;

    setSendingReset(true);
    const { error } = await sendPasswordResetEmail(authUser.email);
    setSendingReset(false);

    if (error) {
      console.error("Erro ao enviar e-mail de redefinição:", error);
      toast.error("Não foi possível enviar o e-mail. Tente novamente.");
      return;
    }

    setResetSent(true);
  };

  return (
    <div className="fixed inset-0 z-[9999]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="absolute left-1/2 top-1/2 max-h-[90dvh] w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl">
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
            {resetSent ? (
              <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                Enviamos um link para <strong>{authUser?.email}</strong>. Abra o
                e-mail e siga as instruções para definir a nova senha.
              </p>
            ) : (
              <p className="text-sm text-gray-500">
                Por segurança, a troca de senha é feita por um link enviado ao
                seu e-mail.
              </p>
            )}
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                variant={resetSent ? "secondary" : "primary"}
                onClick={handleSendPasswordReset}
                isLoading={sendingReset}
                disabled={!authUser?.email}
              >
                {resetSent ? "Reenviar link" : "Enviar link por e-mail"}
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
