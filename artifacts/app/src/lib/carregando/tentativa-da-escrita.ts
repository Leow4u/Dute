import { useState } from "react";

import { SEM_CONFIRMACAO_DO_SERVIDOR } from "@/components/ui/aviso-de-espera";

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
 * formulário), sem o que muda sozinho (a hora, a releitura, o encaixe que o
 * motor devolve de novo): o que vai ao servidor, normalizado (o número, e não
 * o texto do campo). Só a última tentativa fica: o pedido que muda e volta é
 * outro pedido, como na contagem que passa de 10 para 12 e volta a 10.
 *
 * Depois do resultado incerto, a tela diz que não houve confirmação (nunca
 * que falhou) e o botão diz "Tentar de novo" enquanto o pedido é o mesmo
 * (`repete`): repetir assim leva a mesma chave e nunca grava duas vezes.
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
  /**
   * O próximo envio deste pedido repete a tentativa de um resultado incerto
   * (o "Tentar de novo"). Falso antes do primeiro resultado, depois do
   * sucesso e da recusa, e para outro pedido. Lido no render: muda quando o
   * envio termina, e a mutação que o chama renderiza de novo.
   */
  repete(pedido: unknown): boolean;
  /** Esquece a tentativa guardada: o próximo envio é outro pedido. */
  esquecer(): void;
}

interface Guardada {
  assinatura: string;
  corpo: object & { idempotency_key: string };
  /** Já teve um resultado incerto: o próximo envio é a repetição. */
  incerta: boolean;
}

const assinaturaDo = (pedido: unknown) => JSON.stringify(pedido ?? null);

export function criarTentativaDaEscrita(novaChave: () => string = () => crypto.randomUUID()): TentativaDaEscrita {
  let guardada: Guardada | null = null;
  return {
    enviar<Corpo extends object, Resultado>(
      pedido: unknown,
      montar: () => Corpo,
      mandar: (corpo: Corpo & { idempotency_key: string }) => Promise<Resultado>,
    ): Promise<Resultado> {
      const assinatura = assinaturaDo(pedido);
      if (guardada?.assinatura !== assinatura) {
        guardada = { assinatura, corpo: { ...montar(), idempotency_key: novaChave() }, incerta: false };
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
          else tentativa.incerta = true;
          throw erro;
        },
      );
    },
    repete(pedido: unknown) {
      return guardada !== null && guardada.incerta && guardada.assinatura === assinaturaDo(pedido);
    },
    esquecer() {
      guardada = null;
    },
  };
}

/**
 * O aviso do erro de uma escrita de formulário: a recusa do servidor diz que
 * não gravou (o título da tela, em vermelho); o resultado incerto diz que não
 * houve confirmação, sem o vermelho, porque a escrita pode ter valido, e o
 * botão da tela diz "Tentar de novo" (`repete`).
 */
export function avisoDoErroDaEscrita(erro: unknown, naRecusa: string): { title: string; variant?: "destructive" } {
  return desfechoDoErro(erro) === "recusado" ? { title: naRecusa, variant: "destructive" } : { title: SEM_CONFIRMACAO_DO_SERVIDOR };
}

/** A tentativa de uma escrita da tela, que dura enquanto a tela está montada. */
export function useTentativaDaEscrita(): TentativaDaEscrita {
  const [tentativa] = useState(() => criarTentativaDaEscrita());
  return tentativa;
}
