import { FalhaNaLeitura } from "@/components/ui/erro-na-leitura";
import { useActiveCustomer } from "@/lib/active-customer-context";

/** O que a tela diz no lugar do dado quando a lista dos clientes não veio. */
export const SEM_O_CLIENTE_ATIVO = "Não consegui carregar o cliente ativo.";

/**
 * A tela interna que lê ou grava pelo cliente ativo, com a lista dos clientes
 * que falhou (o seletor diz "Não carregou"): no lugar do dado, a falha, com
 * "Tentar de novo", que lê de novo a lista dos clientes (o `tentar` do
 * `useActiveCustomer`), nunca o dado da tela. Sem a lista, o `code` é o do
 * cliente padrão, e a tela não lê nem grava com ele (o `customer_code` é a
 * fronteira; carregamento v2, junção das partes 10 e 13). A falha fica durante
 * a nova tentativa, com "Tentando de novo…" no relógio da espera, e quando a
 * lista chega o foco vai a `focoAoSair`, nunca ao `body`. Na falta de
 * conexão, o bloco da conexão.
 */
export function FalhaDoClienteAtivo({ className, focoAoSair }: { className?: string; focoAoSair?: string }) {
  const { erro, tentar } = useActiveCustomer();
  return <FalhaNaLeitura leitura={{ error: erro, refetch: tentar }} mensagem={SEM_O_CLIENTE_ATIVO} className={className} focoAoSair={focoAoSair} />;
}
