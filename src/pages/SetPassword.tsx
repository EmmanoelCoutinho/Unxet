import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { canSetPassword, clearSetPasswordGrant } from "../lib/passwordLink";
import { translateAuthError } from "../lib/authErrors";
import { PasswordInput } from "../components/ui/PasswordInput";
import { LegalConsent } from "../components/LegalLinks";
import { AuthShell } from "../components/AuthShell";
import { Button } from "../components/ui/Button";
import { CheckCircle2, Circle, LockKeyhole } from "lucide-react";

export const SetPassword: React.FC = () => {
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(false);

  const canSubmit = useMemo(() => {
    return allowed && password.length >= 8 && password === confirm && !loading;
  }, [allowed, confirm, loading, password]);

  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      // Só libera para quem acabou de abrir um link de convite/redefinição.
      // Uma sessão comum (já logada) precisa pedir o link por e-mail.
      if (canSetPassword(data.session)) {
        setAllowed(true);
      } else {
        setError(
          "Este acesso expirou ou não veio de um link enviado por e-mail. Solicite um novo link para definir sua senha.",
        );
      }
      setCheckingSession(false);
    };
    check();
  }, []);

  const handleSubmit = async () => {
    setError(null);

    if (password.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }

    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }

    setLoading(true);
    try {
      const { error: updError } = await supabase.auth.updateUser({ password });
      if (updError) throw updError;

      clearSetPasswordGrant();
      navigate("/inbox", { replace: true });
    } catch (e: any) {
      setError(translateAuthError(e, "Erro ao definir senha. Tente novamente."));
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-gray-200 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0A84FF] focus:border-transparent";

  const rules = [
    { ok: password.length >= 8, label: "Pelo menos 8 caracteres" },
    { ok: password.length > 0 && password === confirm, label: "As duas senhas são iguais" },
  ];

  return (
    <AuthShell
      icon={<LockKeyhole className="h-7 w-7" />}
      title="Crie sua nova senha"
      subtitle="Escolha uma senha para acessar a Unxet."
    >
      {checkingSession ? (
        <p className="text-center text-sm text-gray-500">Verificando o link…</p>
      ) : (
        <>
          {error && (
            <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
              {!allowed && (
                <Link
                  to="/forgot-password"
                  className="mt-2 block font-medium underline"
                >
                  Receber novo link por e-mail
                </Link>
              )}
            </div>
          )}

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) handleSubmit();
            }}
          >
            <label className="block text-sm font-medium text-gray-900">
              Nova senha
              <PasswordInput
                containerClassName="mt-1"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                placeholder="Mínimo 8 caracteres"
                disabled={!allowed}
                autoFocus
              />
            </label>

            <label className="block text-sm font-medium text-gray-900">
              Confirmar senha
              <PasswordInput
                containerClassName="mt-1"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputClass}
                placeholder="Repita a senha"
                disabled={!allowed}
              />
            </label>

            <ul className="space-y-1.5">
              {rules.map((rule) => (
                <li
                  key={rule.label}
                  className={`flex items-center gap-2 text-sm ${rule.ok ? "text-[#0A84FF]" : "text-gray-400"}`}
                >
                  {rule.ok ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Circle className="h-4 w-4" />
                  )}
                  {rule.label}
                </li>
              ))}
            </ul>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={!canSubmit}
              isLoading={loading}
            >
              Salvar senha
            </Button>
            <LegalConsent action="Ao salvar a senha" />
          </form>
        </>
      )}
    </AuthShell>
  );
};
