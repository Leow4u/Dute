import { collection, query, where } from "firebase/firestore";

import type { ItemDoInicio } from "../inicio-do-modulo";
import type { ProfileRole } from "../modules";
import { colaboradorDaLeitura, veiculoDaLeitura } from "./cadastro";
import { clienteDaLeitura, comDemanda, demandaDaFila, hojeIso, nomesPorCodigo, osDaLeitura } from "./fila";
import { useLeitura } from "./leitura";
import { abreOperacao } from "./navegacao";
import {
  equipeDeHoje,
  hojeNaOperacao,
  pendenciasDaOperacao,
  type EntradaDoInicio,
  type HojeNaOperacao,
  type PessoaDeHoje,
} from "./pendencias";

export type InicioDaOperacao = {
  itens: ItemDoInicio[];
  /** Os números do dia; undefined enquanto as OS não chegaram. */
  numeros: HojeNaOperacao | undefined;
  /** A equipe de hoje; undefined enquanto OS e cadastro não chegaram. */
  equipe: PessoaDeHoje[] | undefined;
  carregando: boolean;
  /** As leituras que falharam, em palavras ("ordens de serviço", "colaboradores"). */
  falhas: string[];
};

/**
 * As leituras do Início da Operação, ao vivo como o resto do módulo, e só para
 * quem abre a Operação (owner, admin e interno): para os outros papéis, nada
 * é assinado. As OS lidas são só as abertas e agendadas. O SDK do Firestore
 * junta as assinaturas iguais (o menu e o Início): a leitura sai uma vez.
 * `ligado` falso não assina nada.
 */
export function useInicioDaOperacao(role: ProfileRole | null | undefined, agora: Date = new Date(), ligado = true): InicioDaOperacao {
  const abre = ligado && abreOperacao(role);
  const chave = (nome: string) => (abre ? nome : null);
  const ordens = useLeitura(
    chave("service_orders:ativas"),
    (db) => query(collection(db, "service_orders"), where("status", "in", ["aberta", "agendada"])),
    osDaLeitura,
  );
  const demandas = useLeitura(chave("demands"), (db) => collection(db, "demands"), demandaDaFila);
  const pessoas = useLeitura(chave("collaborators"), (db) => collection(db, "collaborators"), colaboradorDaLeitura);
  const veiculos = useLeitura(chave("vehicles"), (db) => collection(db, "vehicles"), veiculoDaLeitura);
  const clientes = useLeitura(chave("customers"), (db) => collection(db, "customers"), clienteDaLeitura);

  const leituras = [
    { leitura: ordens, nome: "ordens de serviço" },
    { leitura: demandas, nome: "demandas" },
    { leitura: pessoas, nome: "colaboradores" },
    { leitura: veiculos, nome: "veículos" },
    { leitura: clientes, nome: "clientes" },
  ];
  const falhas = abre ? leituras.filter(({ leitura }) => leitura.erro).map(({ nome }) => nome) : [];
  const carregando = abre && leituras.some(({ leitura }) => !leitura.erro && !leitura.itens);
  const prontas = leituras.every(({ leitura }) => leitura.itens);

  const entrada: EntradaDoInicio = {
    hoje: hojeIso(agora),
    agora,
    ordens: comDemanda(ordens.itens ?? [], demandas.itens ?? []),
    demandas: (demandas.itens ?? []).flatMap((demanda) => (demanda.paraAbrir ? [demanda.paraAbrir] : [])),
    pessoas: pessoas.itens ?? [],
    veiculos: veiculos.itens ?? [],
    nomesClientes: nomesPorCodigo(clientes.itens ?? []),
  };
  return {
    // Sem todas as leituras, uma lista parcial diria "nada parado" sem saber.
    itens: abre && prontas ? pendenciasDaOperacao(entrada) : [],
    numeros: abre && ordens.itens && demandas.itens ? hojeNaOperacao(entrada) : undefined,
    equipe: abre && ordens.itens && demandas.itens && pessoas.itens ? equipeDeHoje(entrada) : undefined,
    carregando,
    falhas,
  };
}
