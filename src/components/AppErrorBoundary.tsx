import React from "react";

type Props = {
  children: React.ReactNode;
  // Mudou a rota: limpa o erro para a próxima tela poder renderizar
  resetKey?: string;
};

type State = { hasError: boolean };

/**
 * Sem isto, um erro de renderização em qualquer tela deixava o app inteiro
 * em branco (inclusive o menu), sem saída para o usuário.
 */
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("Erro ao renderizar a tela:", error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex h-full min-h-[60dvh] w-full items-center justify-center bg-white p-6">
        <div className="max-w-sm text-center">
          <h2 className="text-lg font-semibold text-gray-900">
            Algo deu errado nesta tela
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            Recarregue a página. Se o problema continuar, volte para o início.
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-[#0A84FF] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0066d6]"
            >
              Recarregar
            </button>
            <a
              href="/inbox"
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
            >
              Ir para o início
            </a>
          </div>
        </div>
      </div>
    );
  }
}
