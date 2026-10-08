import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { canSetPassword, clearSetPasswordGrant } from "../lib/passwordLink";
import { translateAuthError } from "../lib/authErrors";

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

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-4 sm:p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">Defina sua senha</h1>
        <p className="mt-2 text-sm text-gray-600">
          Defina uma senha para acessar o sistema.
        </p>

        {checkingSession ? (
          <p className="mt-4 text-sm text-gray-500">Verificando sessão…</p>
        ) : (
          <>
            {error && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
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

            <div className="mt-5 space-y-3">
              <label className="block text-sm font-medium text-gray-700">
                Senha
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Mínimo 8 caracteres"
                />
              </label>

              <label className="block text-sm font-medium text-gray-700">
                Confirmar senha
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Repita a senha"
                />
              </label>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="mt-2 w-full rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {loading ? "Salvando…" : "Salvar senha"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
