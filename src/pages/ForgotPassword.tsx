import React, { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, KeyRound, MailCheck } from 'lucide-react';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { AuthShell } from '../components/AuthShell';
import { toast } from 'react-toastify';
import { useAuth } from '../contexts/AuthContext';
import { translateAuthError } from '../lib/authErrors';

export const ForgotPassword: React.FC = () => {
  const { sendPasswordResetEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!email) {
      toast.error('Por favor, insira o seu e-mail.');
      return;
    }

    try {
      setLoading(true);
      const { error } = await sendPasswordResetEmail(email);
      if (error) throw error;
      setSentTo(email);
      setEmail('');
    } catch (err: any) {
      toast.error(translateAuthError(err, 'Erro ao tentar enviar o e-mail de redefinição.'));
    } finally {
      setLoading(false);
    }
  }

  const backLink = (
    <div className="mt-6 text-center">
      <Link
        to="/login"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0A84FF] hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para o login
      </Link>
    </div>
  );

  if (sentTo) {
    return (
      <AuthShell
        icon={<MailCheck className="h-7 w-7" />}
        title="Verifique seu e-mail"
        subtitle={
          <>
            Se <span className="font-medium text-gray-900">{sentTo}</span> estiver
            cadastrado, você vai receber um link para criar uma nova senha.
          </>
        }
      >
        <div className="rounded-xl bg-[#0A84FF]/5 border border-[#0A84FF]/20 px-4 py-3 text-sm text-gray-600">
          Não chegou? Confira a caixa de spam ou{' '}
          <button
            type="button"
            onClick={() => setSentTo(null)}
            className="font-medium text-[#0A84FF] hover:underline"
          >
            envie de novo
          </button>
          .
        </div>
        {backLink}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      icon={<KeyRound className="h-7 w-7" />}
      title="Recuperar senha"
      subtitle="Digite o seu e-mail cadastrado e enviaremos um link para você criar uma nova senha."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="E-mail"
          type="email"
          placeholder="seu@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          autoFocus
        />

        <Button type="submit" variant="primary" className="w-full" isLoading={loading}>
          Enviar link de recuperação
        </Button>
      </form>
      {backLink}
    </AuthShell>
  );
};
