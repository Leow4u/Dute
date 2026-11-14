import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { EstadoDaAcao } from "@/components/ui/botao-de-acao";
import { callableSemResposta, ehFaltaDeConexao } from "@/lib/conexao";

import { CARREGANDO } from "./tempo";

/** A ação que falhou numa linha e o erro dela, para o selo e o motivo ("Saldo insuficiente para 12 un."). */
export interface MotivoNaLinha {
  acao: string;
  erro: unknown;
}

export interface OpcoesDaAcao {
  /**
   * Relê o objeto quando a pessoa toca em "Conferir" (sem resposta aos 70 s).
   * Nunca reenvia. `true`: a ação já valeu, e segue o sucesso. `false`: volta
   * ao repouso ("Aprovar"), e a nova tentativa leva a mesma chave. Sem ela, o
   * "Conferir" só volta ao repouso, também guardando a chave.
   */
  conferir?: () => Promise<boolean>;
  /**
   * A releitura da lista depois do sucesso: o "Aprovado" fica até ela chegar,
   * e pelo menos 1 s. A que falha ou não chega solta a linha na desistência.
   */
  releitura?: () => Promise<unknown>;
}

export interface AcaoNaLinha<Id extends string> {
  /** O estado do botão da ação na linha; a outra ação da mesma linha fica em repouso. */
  estado(id: Id, acao: string): EstadoDaAcao;
  /** Em andamento, no sucesso (de saída) e sem resposta: as outras ações da linha ficam travadas. */
  ocupada(id: Id): boolean;
  /** Quando começou a espera em andamento, no relógio do `performance.now()` (o do useEspera); nulo fora dela. */
  desde(id: Id): number | null;
  /** A ação que falhou e o erro, desde o erro até a próxima ação na linha. */
  motivo(id: Id): MotivoNaLinha | null;
  /**
   * Faz a ação da linha com a chave de idempotência da tentativa. Na linha
   * ocupada, não faz nada; sem resposta na mesma ação, é o "Conferir". Nunca
   * rejeita: o resultado fica no estado da linha.
   */
  executar(id: Id, acao: string, fazer: (chave: string) => Promise<unknown>, opcoes?: OpcoesDaAcao): Promise<void>;
}

/**
 * O que o erro diz da tentativa. `sem-resposta`: o prazo acabou sem resposta
 * (o "Conferir"). `recusado`: o servidor respondeu que não, antes de gravar;
 * a próxima tentativa é nova. `incerto`: todo o resto, que não diz se valeu
 * (sem conexão, sem resposta, a falha interna, o erro sem código); a
 * repetição leva a mesma chave. Na dúvida, guardar: o recibo só nasce no
 * sucesso, e a mesma chave nunca duplica.
 */
export type DesfechoDoErro = "sem-resposta" | "incerto" | "recusado";

/** Os códigos com que a callable diz que não antes de gravar (o 4xx da resposta de `/api/*`). */
const RECUSAS_DO_SERVIDOR: ReadonlySet<string> = new Set([
  "invalid-argument",
  "failed-precondition",
  "out-of-range",
  "unauthenticated",
  "permission-denied",
  "not-found",
  "already-exists",
  "aborted",
  "resource-exhausted",
  "unimplemented",
]);

export function desfechoDoErro(erro: unknown): DesfechoDoErro {
  const lido = erro as { code?: unknown; status?: unknown; data?: { code?: unknown } | null } | null;
  const codigo = String(lido?.code ?? lido?.data?.code ?? "").replace(/^functions\//, "");
  if (codigo === "deadline-exceeded") return "sem-resposta";
  if (ehFaltaDeConexao(erro) || callableSemResposta(erro)) return "incerto";
  if (RECUSAS_DO_SERVIDOR.has(codigo)) return "recusado";
  const status = typeof lido?.status === "number" ? lido.status : null;
  return status !== null && status >= 400 && status < 500 ? "recusado" : "incerto";
}

/**
 * Quando o resultado entra no botão (o BotaoDeAcao, no relógio do useEspera
 * com o mínimo): na hora, se a espera acabou antes de 300 ms e o indicador
 * nem apareceu; senão, quando o "em andamento" completa os 500 ms na tela.
 */
export function resultadoNaTelaEm(inicio: number, fim: number): number {
  if (fim - inicio < CARREGANDO.atrasoMs) return fim;
  return Math.max(fim, inicio + CARREGANDO.atrasoMs + CARREGANDO.minimoMs);
}

interface Linha {
  acao: string;
  estado: EstadoDaAcao;
  desde: number | null;
  motivo: MotivoNaLinha | null;
}

interface Registro {
  linha: Linha;
  /** Cada espera tem a sua vez; o que chega de uma vez passada não mexe na linha. */
  vez: number;
  /** O começo da espera desta vez. */
  inicio: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const OCUPADOS: ReadonlySet<EstadoDaAcao> = new Set(["andamento", "sucesso", "sem-resposta"]);

const agora = () => performance.now();

/** Chama já, e o que quebra na hora vira a rejeição. */
function chamar<T>(fazer: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(fazer());
  } catch (erro) {
    return Promise.reject(erro);
  }
}

function criarLoja<Id extends string>() {
  const registros = new Map<Id, Registro>();
  /**
   * A chave de cada tentativa cujo resultado ficou incerto, por linha e ação:
   * a repetição a leva de novo. O sucesso de qualquer ação na linha encerra
   * as da linha: a linha andou, e a próxima ação é nova (repetir a chave
   * velha devolveria o recibo de antes, sem fazer nada).
   */
  const chaves = new Map<Id, Map<string, string>>();
  const chaveDa = (id: Id, acao: string): string => {
    let daLinha = chaves.get(id);
    if (!daLinha) chaves.set(id, (daLinha = new Map()));
    let chave = daLinha.get(acao);
    if (!chave) daLinha.set(acao, (chave = crypto.randomUUID()));
    return chave;
  };
  const encerrar = (id: Id, acao: string) => {
    const daLinha = chaves.get(id);
    daLinha?.delete(acao);
    if (daLinha?.size === 0) chaves.delete(id);
  };
  const ouvintes = new Set<() => void>();
  let instantaneo: ReadonlyMap<Id, Linha> = new Map();
  let vezes = 0;
  let aberta = true;

  const publicar = () => {
    instantaneo = new Map(Array.from(registros, ([id, registro]) => [id, registro.linha]));
    for (const ouvinte of ouvintes) ouvinte();
  };

  /** O registro da linha, se ainda é desta vez e a tela está montada. */
  const daVez = (id: Id, vez: number): Registro | null => {
    const registro = registros.get(id);
    return aberta && registro?.vez === vez ? registro : null;
  };

  const desarmar = (registro: Registro | undefined) => {
    if (registro?.timer) clearTimeout(registro.timer);
    if (registro) registro.timer = null;
  };

  const armar = (id: Id, vez: number, ate: number, quando: (registro: Registro) => void) => {
    const registro = daVez(id, vez);
    if (!registro) return;
    desarmar(registro);
    registro.timer = setTimeout(() => {
      const atual = daVez(id, vez);
      if (!atual) return;
      atual.timer = null;
      quando(atual);
    }, Math.max(0, ate - agora()));
  };

  const mudar = (registro: Registro, linha: Partial<Linha>) => {
    registro.linha = { ...registro.linha, ...linha };
    publicar();
  };

  /** Volta ao repouso, sem motivo. */
  const soltar = (id: Id, vez: number) => {
    const registro = daVez(id, vez);
    if (!registro) return;
    desarmar(registro);
    registros.delete(id);
    publicar();
  };

  const semResposta = (id: Id, vez: number) => {
    const registro = daVez(id, vez);
    if (!registro) return;
    desarmar(registro);
    mudar(registro, { estado: "sem-resposta", desde: null });
  };

  /** A espera começa: em andamento, com a desistência aos 70 s. */
  const comecar = (id: Id, acao: string): number => {
    desarmar(registros.get(id));
    vezes += 1;
    const vez = vezes;
    const inicio = agora();
    registros.set(id, { linha: { acao, estado: "andamento", desde: inicio, motivo: null }, vez, inicio, timer: null });
    armar(id, vez, inicio + CARREGANDO.desisteMs, () => semResposta(id, vez));
    publicar();
    return vez;
  };

  /** "Aprovado" fica pelo menos 1 s no botão e até a releitura chegar (no máximo até a desistência). */
  const sucesso = (id: Id, vez: number, releitura?: () => Promise<unknown>) => {
    const registro = daVez(id, vez);
    if (!registro) return;
    chaves.delete(id);
    const fim = agora();
    let releu = !releitura;
    let cumpriu = false;
    armar(id, vez, resultadoNaTelaEm(registro.inicio, fim) + CARREGANDO.sucessoVisivelMs, () => {
      cumpriu = true;
      if (releu) soltar(id, vez);
      else armar(id, vez, fim + CARREGANDO.desisteMs, () => soltar(id, vez));
    });
    if (releitura) {
      void chamar(releitura)
        .catch(() => undefined)
        .then(() => {
          releu = true;
          if (cumpriu) soltar(id, vez);
        });
    }
    mudar(registro, { estado: "sucesso", desde: null, motivo: null });
  };

  /** "Não aprovado" fica 2 s no botão; depois ele volta, e o motivo fica na linha até a próxima ação. */
  const falhou = (id: Id, vez: number, erro: unknown) => {
    const registro = daVez(id, vez);
    if (!registro) return;
    const fim = agora();
    armar(id, vez, resultadoNaTelaEm(registro.inicio, fim) + CARREGANDO.erroVisivelMs, (atual) => mudar(atual, { estado: "repouso" }));
    mudar(registro, { estado: "erro", desde: null, motivo: { acao: registro.linha.acao, erro } });
  };

  /** O "Conferir": relê e nunca reenvia. */
  const conferir = (id: Id, acao: string, opcoes: OpcoesDaAcao): Promise<void> => {
    const registro = registros.get(id);
    const ler = opcoes.conferir;
    if (!registro || !ler) {
      // Sem como reler, volta ao repouso; a chave fica para a próxima tentativa.
      if (registro) soltar(id, registro.vez);
      return Promise.resolve();
    }
    const vez = comecar(id, acao);
    return chamar(ler).then(
      (valeu) => {
        if (!daVez(id, vez)) return;
        if (valeu !== true) {
          soltar(id, vez);
          return;
        }
        sucesso(id, vez, opcoes.releitura);
      },
      // A leitura que falha não diz nada: continua sem resposta.
      () => semResposta(id, vez),
    );
  };

  const executar = (id: Id, acao: string, fazer: (chave: string) => Promise<unknown>, opcoes: OpcoesDaAcao = {}): Promise<void> => {
    if (!aberta) return Promise.resolve();
    const linha = registros.get(id)?.linha;
    if (linha?.estado === "sem-resposta" && linha.acao === acao) return conferir(id, acao, opcoes);
    if (linha && OCUPADOS.has(linha.estado)) return Promise.resolve();

    const chave = chaveDa(id, acao);
    const vez = comecar(id, acao);
    return chamar(() => fazer(chave)).then(
      () => sucesso(id, vez, opcoes.releitura),
      (erro: unknown) => {
        const registro = daVez(id, vez);
        if (!registro) return;
        const desfecho = desfechoDoErro(erro);
        if (desfecho === "sem-resposta") {
          semResposta(id, vez);
          return;
        }
        // Depois dos 70 s, o que ainda não diz se valeu não muda o "Conferir".
        if (desfecho === "incerto" && registro.linha.estado === "sem-resposta") return;
        if (desfecho === "recusado") encerrar(id, acao);
        falhou(id, vez, erro);
      },
    );
  };

  return {
    executar,
    ler: () => instantaneo,
    assinar: (ouvinte: () => void) => {
      ouvintes.add(ouvinte);
      return () => {
        ouvintes.delete(ouvinte);
      };
    },
    abrir: () => {
      aberta = true;
    },
    /** A tela saiu: nenhum relógio fica, e o que chegar depois não muda nada. */
    fechar: () => {
      aberta = false;
      for (const registro of registros.values()) desarmar(registro);
    },
  };
}

/**
 * A ação por linha do carregamento v2 (aprovado em 12/11/2026, seção 9 e
 * momento 4), no lugar do `busy` global de Pedidos e dos `isPending`
 * compartilhados: aprovar a 1042 deixa a 1043 e a 1045 livres, e cada linha
 * pode ter a própria ação ao mesmo tempo.
 *
 * - O segundo toque na linha ocupada (em andamento, no sucesso ou sem
 *   resposta) não faz nada, também o de outra ação da mesma linha.
 * - A chave de idempotência é por tentativa: nova a cada ação, e a mesma na
 *   repetição quando o resultado ficou incerto (sem conexão, sem resposta, a
 *   falha interna do servidor, o erro sem código) e na nova tentativa depois
 *   do "Conferir". Só a recusa do servidor e o sucesso de uma ação na linha
 *   encerram a chave guardada.
 * - Aos 70 s sem resposta, a linha fica sem resposta ("Conferir", que relê
 *   pelo `conferir` e nunca reenvia). A resposta que chega depois ainda vale.
 * - O sucesso fica pelo menos 1 s no botão, contado de quando ele o mostra
 *   (depois do mínimo de 500 ms do "em andamento"), e até a `releitura`
 *   chegar. O erro fica 2 s e volta ao repouso; o motivo fica para a linha
 *   até a próxima ação nela.
 *
 * Quem anuncia ("Aprovando pedido 1042"), mostra o toast e tira a linha da
 * lista é a tela.
 */
export function useAcaoNaLinha<Id extends string>(): AcaoNaLinha<Id> {
  const [loja] = useState(() => criarLoja<Id>());
  const linhas = useSyncExternalStore(loja.assinar, loja.ler, loja.ler);

  useEffect(() => {
    loja.abrir();
    return loja.fechar;
  }, [loja]);

  return useMemo<AcaoNaLinha<Id>>(
    () => ({
      estado: (id, acao) => {
        const linha = linhas.get(id);
        return linha?.acao === acao ? linha.estado : "repouso";
      },
      ocupada: (id) => {
        const estado = linhas.get(id)?.estado;
        return estado !== undefined && OCUPADOS.has(estado);
      },
      desde: (id) => linhas.get(id)?.desde ?? null,
      motivo: (id) => linhas.get(id)?.motivo ?? null,
      executar: loja.executar,
    }),
    [linhas, loja],
  );
}
