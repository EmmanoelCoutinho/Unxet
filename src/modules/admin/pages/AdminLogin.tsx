import React, { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "react-toastify";
import { Card } from "../../../components/ui/Card";
import { Input } from "../../../components/ui/Input";
import { Button } from "../../../components/ui/Button";
import logo from "../../../assets/logo-unxet.png";
import { translateAuthError } from "../../../lib/authErrors";
import { NOT_PLATFORM_ADMIN, useAdminAuth } from "../contexts/AdminAuthContext";

export const AdminLogin: React.FC = () => {
  const { adminUser, signIn } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (adminUser) return <Navigate to="/admin/onboarding" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await signIn(email.trim(), password);
    setSubmitting(false);
    if (!error) return;

    toast.error(
      error.code === NOT_PLATFORM_ADMIN
        ? "Esta conta não tem acesso ao painel administrativo."
        : "Erro ao entrar: " +
            translateAuthError(error, "Não foi possível entrar. Tente novamente."),
    );
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-5 sm:p-8">
        <div className="text-center mb-8">
          <img
            src={logo}
            alt="Unxet"
            className="mx-auto w-56 mb-2 object-contain"
          />
          <p className="text-[#1E1E1E] text-lg">Painel administrativo</p>
          <p className="mt-1 text-sm text-gray-500">
            Acesso restrito à equipe da Unxet
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="E-mail"
            type="email"
            placeholder="seu@email.com"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            label="Senha"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button
            type="submit"
            variant="secondary"
            className="w-full"
            isLoading={submitting}
          >
            Entrar
          </Button>
        </form>
      </Card>
    </div>
  );
};
