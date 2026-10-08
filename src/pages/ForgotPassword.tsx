import React, { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import logo from '../assets/logo-unxet.png';
import { toast } from 'react-toastify';
import { useAuth } from '../contexts/AuthContext'; // Importado o hook de auth

export const ForgotPassword: React.FC = () => {
  const { sendPasswordResetEmail } = useAuth(); // Extraído o método do contexto
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!email) {
      toast.error('Por favor, insira o seu e-mail.');
      return;
    }

    try {
      setLoading(true);
      
      // Executa a chamada ao Supabase
      const { error } = await sendPasswordResetEmail(email);
      
      if (error) {
        throw error;
      }

      toast.success('E-mail de redefinição enviado! Verifique sua caixa de entrada.');
      setEmail(''); 
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao tentar enviar o e-mail de redefinição.');
    } finally {
      setLoading(false);
    }
  }

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

        <h2 className="text-2xl font-semibold text-[#1E1E1E] mb-2">Recuperar Senha</h2>
        <p className="text-sm text-gray-500 mb-6">
          Digite o seu e-mail cadastrado e enviaremos um link para você criar uma nova senha.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="E-mail"
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
          />

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            isLoading={loading}
          >
            Enviar link de recuperação
          </Button>
        </form>

        <div className="mt-6 text-center">
          <Link to="/login" className="text-sm text-[#0A84FF] hover:underline">
            Voltar para o Login
          </Link>
        </div>
      </Card>
    </div>
  );
};