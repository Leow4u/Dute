/**
 * A leitura que ainda não deu a lista, para o formulário que mostra a lista
 * (os clientes do Novo orçamento, o catálogo da Nova demanda, os contatos da
 * resposta do orçamento): lendo, ou a falha, com a nova tentativa. O
 * "Nenhum…" só vale com a leitura feita: nunca afirmar vazio antes da
 * primeira leitura (carregamento v2, parte 13i). Na falha, o que falta: a
 * conexão (o aviso da conexão) ou o servidor (a falha da seção; parte 13l).
 */
export type LeituraPendente = {
  estado: "carregando" | "erro";
  tentando: boolean;
  tentar: () => void;
  falta?: "conexao" | "servidor" | null;
};

/** A leitura ao vivo como o formulário a mostra: pendente (lendo, ou a falha) ou, já lida, nada. */
export function leituraPendente(leitura: {
  itens: readonly unknown[] | null;
  erro: boolean;
  tentando?: boolean;
  tentar?: () => unknown;
  falta?: "conexao" | "servidor" | null;
}): LeituraPendente | undefined {
  if (!leitura.erro && leitura.itens !== null) return undefined;
  const tentar = leitura.tentar;
  return {
    estado: leitura.erro ? "erro" : "carregando",
    tentando: leitura.tentando ?? false,
    tentar: () => void tentar?.(),
    falta: leitura.erro ? (leitura.falta ?? null) : null,
  };
}
