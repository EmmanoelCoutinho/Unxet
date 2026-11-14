import React, { FormEvent, useEffect, useState } from 'react';
// 1. Importamos o Link do react-router-dom
import { useLocation, useNavigate, Link } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { AuthShell } from '../components/AuthShell';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'react-toastify';
import { translateAuthError } from '../lib/authErrors';
import { LegalConsent, StatusNotice } from '../components/LegalLinks';

const translateLoginError = (error: { code?: string; message?: string }) =>
  translateAuthError(error, 'Não foi possível entrar. Tente novamente.');

export const Login: React.FC = () => {
  const { signInWithEmail, loading, authUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [error] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const { error } = await signInWithEmail(email, password);
    if (!error) {
      navigate('/inbox');
    } else {
      toast.error('Erro ao entrar: ' + translateLoginError(error));
    }
  }

  useEffect(() => {
    if (!authUser) {
      return;
    }
    const from = (location.state as { from?: Location })?.from?.pathname;
    navigate(from || '/inbox', { replace: true });
  } , [authUser, location.state, navigate]);

  return (
    <AuthShell
      title="Entrar"
      subtitle="Acesse a sua Central de Mensagens."
    >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="E-mail"
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
          />
          
          {/* Container do campo de senha + link de esqueci a senha */}
          <div className="space-y-1">
            <Input
              label="Senha"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {/* 2. Adicionado o link de redefinir senha logo abaixo do input */}
            <div className="text-right">
              <Link 
                to="/forgot-password" 
                className="text-xs text-[#0A84FF] hover:underline"
              >
                Esqueceu sua senha?
              </Link>
            </div>
          </div>

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            isLoading={loading}
          >
            Entrar
          </Button>
        </form>

        <LegalConsent action="Ao entrar" className="mt-4" />
        <StatusNotice className="mt-2" />
    </AuthShell>
  );
};