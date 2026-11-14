import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
      // Sem rede, o padrão ("online") pausava a leitura, e a tela, sem erro e
      // sem carregando, afirmava a lista vazia. Com "always", a leitura vai à
      // camada do Firestore, que responde "Sem conexão" na hora
      // (lib/conexao.ts; docs/plataforma/diagnostico-carregamento.md, seção 9,
      // decisão 2 do celular). Na volta da rede, o refetchOnReconnect relê; e,
      // com o aparelho conectado e o servidor sem resposta, o estado da conexão
      // relê sozinho (lib/carregando/estado-da-conexao.ts, ligado no main.tsx).
      networkMode: 'always',
    },
    mutations: {
      // Sem rede, o padrão pausava a ação em "Registrando...", e ela saía
      // sozinha minutos depois, sem aviso. A ação é recusada na hora com
      // "Sem conexão" (decisão 1 do celular). A fila do Campo não passa por
      // aqui: tem a dela (lib/campo/fila-do-campo.tsx).
      networkMode: 'always',
    },
  },
});
