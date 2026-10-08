import React, { FormEvent, useEffect, useState } from 'react';
// 1. Importamos o Link do react-router-dom
import { useLocation, useNavigate, Link } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { useAuth } from '../contexts/AuthContext';
import logo from '../assets/logo-unxet.png';
import { toast } from 'react-toastify';
import { translateAuthError } from '../lib/authErrors';

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
    <div className="min-h-screen w-full bg-white flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-5 sm:p-8">
        <div className="text-center mb-8">
          <img
            src={logo}
            alt="Unxet"
            className="mx-auto w-56 mb-2 object-contain"
          />
          <p className="text-[#1E1E1E] text-lg">Central de Mensagens</p>
        </div>
        
        <h2 className="text-2xl font-semibold text-[#1E1E1E] mb-6">Entrar</h2>
        
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

        <div className="mt-6 text-center">
          <a href="#" className="text-sm text-[#0A84FF] hover:underline">
            Problemas para entrar?
          </a>
        </div>
      </Card>
    </div>
  );
};