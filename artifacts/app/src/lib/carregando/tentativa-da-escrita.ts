import { useState } from "react";

import { desfechoDoErro } from "./use-acao-na-linha";

/**
 * A tentativa de uma escrita com chave de idempotência (carregamento v2,
 * parte 13k; o diagnóstico, seção 9.1, item 11, e a necessidade 5 do
 * celular), para as escritas de um formulário, fora da linha (a linha usa o
 * `useAcaoNaLinha`). É a regra da guarda da caixa e da exceção da tarefa
 * (parte 13i), numa peça só:
 *
 * - a repetição depois de um resultado incerto (sem conexão, sem resposta, a
 *   falha interna, o erro sem código) leva a mesma chave e o mesmo corpo da
 *   primeira tentativa: se ela valeu, o servidor devolve o recibo dela, e não
 *   grava de novo;
 * - o corpo é montado só na primeira vez: a hora (`occurred_at`,
 *   `received_at`), o status e a revisão que a tela viu e o que veio do
 *   catálogo ficam os da primeira, porque o servidor compara o conteúdo
 *   inteiro com o da chave ("já foi usada com outro conteúdo");
 * - a chave é nova quando a escrita vale, quando o servidor recusa (o 4xx, o
 *   código de recusa: nada foi gravado) ou quando a pessoa muda o pedido.
 *
 * O pedido é o que a pessoa pediu, como a tela o tem (os campos do
 * formulário), sem o que muda sozinho (a hora, a releitura). Só a última
 * tentativa fica: o pedido que muda e volta é outro pedido, como na contagem
 * que passa de 10 para 12 e volta a 10.
 */
export interface TentativaDaEscrita {
  /**
   * Manda o pedido com a chave da tentativa. `montar` dá o corpo e só roda
   * na primeira vez de cada tentativa; `mandar` recebe o corpo com a
   * `idempotency_key`. Rejeita com o erro de `mandar`.
   */
  enviar<Corpo extends object, Resultado>(
    pedido: unknown,
    montar: () => Corpo,
    mandar: (corpo: Corpo & { idempotency_key: string }) => Promise<Resultado>,
  ): Promise<Resultado>;
  /** Esquece a tentativa guardada: o próximo envio é outro pedido. */
  esquecer(): void;
}

interface Guardada {
  assinatura: string;
  corpo: object & { idempotency_key: string };
}

export function criarTentativaDaEscrita(novaChave: () => string = () => crypto.randomUUID()): TentativaDaEscrita {
  let guardada: Guardada | null = null;
  return {
    enviar<Corpo extends object, Resultado>(
      pedido: unknown,
      montar: () => Corpo,
      mandar: (corpo: Corpo & { idempotency_key: string }) => Promise<Resultado>,
    ): Promise<Resultado> {
      const assinatura = JSON.stringify(pedido ?? null);
      if (guardada?.assinatura !== assinatura) {
        guardada = { assinatura, corpo: { ...montar(), idempotency_key: novaChave() } };
      }
      const tentativa = guardada;
      const encerrar = () => {
        if (guardada === tentativa) guardada = null;
      };
      return new Promise<Resultado>((pronto) => pronto(mandar(tentativa.corpo as Corpo & { idempotency_key: string }))).then(
        (resultado) => {
          encerrar();
          return resultado;
        },
        (erro: unknown) => {
          if (desfechoDoErro(erro) === "recusado") encerrar();
          throw erro;
        },
      );
    },
    esquecer() {
      guardada = null;
    },
  };
}

/** A tentativa de uma escrita da tela, que dura enquanto a tela está montada. */
export function useTentativaDaEscrita(): TentativaDaEscrita {
  const [tentativa] = useState(() => criarTentativaDaEscrita());
  return tentativa;
}
