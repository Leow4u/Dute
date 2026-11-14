import { criarConexao, type Conexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";

/**
 * Uma conexão parada no estado pedido, pelo caminho de verdade, para mostrar
 * a tela nele com o `ProvedorDaConexao` (carregamento v2, parte 7a):
 * "reconectando" é o aparelho conectado com uma leitura sem resposta;
 * "sem-conexao", o aparelho sem rede há 3 s. Os relógios ficam parados.
 */
export function conexaoEm(estado: EstadoDaConexao): Conexao {
  let agora = 0;
  const conexao = criarConexao({ temRede: () => estado !== "sem-conexao", agora: () => agora });
  if (estado !== "conectado") {
    agora = 3_000;
    conexao.ficouSemResposta(agora);
  }
  conexao.fechar();
  if (conexao.estado() !== estado) throw new Error(`A conexão do teste ficou em ${conexao.estado()}, não em ${estado}.`);
  return conexao;
}
