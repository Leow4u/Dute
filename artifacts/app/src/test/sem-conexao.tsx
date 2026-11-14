import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProvedorDaConexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosDaTela } from "@/test/textos";

/** 10:42 no fuso do armazém: a hora da lista que ficou na tela. */
export const DEZ_E_QUARENTA_E_DOIS = Date.UTC(2026, 10, 14, 13, 42);

/** A leitura ao vivo como a tela a recebe, num dos estados da falta. */
export type LeituraNaFalta = { tentando: boolean; tentar: () => void; falta: "conexao" | "servidor" | null; lidaEm: number | null };

/** "erro": a leitura falhou sem nada lido; "pronto": a tela tem o que mostrar. */
export type SituacaoDaTela = "erro" | "pronto";

const noop = () => undefined;

const ESTADOS: ReadonlyArray<[string, EstadoDaConexao, LeituraNaFalta, SituacaoDaTela]> = [
  ["sem nada lido, sem conexão", "sem-conexao", { tentando: false, tentar: noop, falta: "conexao", lidaEm: null }, "erro"],
  ["sem nada lido, reconectando", "reconectando", { tentando: false, tentar: noop, falta: "conexao", lidaEm: null }, "erro"],
  ["lida, sem conexão", "sem-conexao", { tentando: false, tentar: noop, falta: "conexao", lidaEm: DEZ_E_QUARENTA_E_DOIS }, "pronto"],
  ["lida, reconectando", "reconectando", { tentando: false, tentar: noop, falta: "conexao", lidaEm: DEZ_E_QUARENTA_E_DOIS }, "pronto"],
  ["erro do servidor", "conectado", { tentando: false, tentar: noop, falta: "servidor", lidaEm: null }, "erro"],
];

/**
 * A tela ao vivo nos estados da falta (carregamento v2, parte 13j; revisão):
 * sem nada lido e sem conexão (o aviso no lugar da lista, em "Sem conexão." e
 * em "Reconectando…"), com o que já foi lido (a faixa, nos dois) e o erro do
 * servidor (a falha da seção). Devolve, por estado, os textos que a tela
 * mostra além dos que mostra em dia, e as violações do axe (WCAG 2.1 A e AA):
 * o teste da tela compara com os rótulos da falta (`rotulosDaFalta`), a
 * trava contra legenda dos estados novos.
 */
export async function estadosDaFalta(tela: (leitura: LeituraNaFalta, situacao: SituacaoDaTela) => ReactElement) {
  const em = (estado: EstadoDaConexao, elemento: ReactElement) =>
    renderToStaticMarkup(<ProvedorDaConexao value={conexaoEm(estado)}>{elemento}</ProvedorDaConexao>);
  const emDia = new Set(textosDaTela(em("conectado", tela({ tentando: false, tentar: noop, falta: null, lidaEm: null }, "pronto"))));
  const resultado: Record<string, { novos: string[]; axe: string[] }> = {};
  for (const [nome, estado, leitura, situacao] of ESTADOS) {
    const html = em(estado, tela(leitura, situacao));
    resultado[nome] = { novos: textosDaTela(html).filter((texto) => !emDia.has(texto)), axe: await violacoesDeAcessibilidade(html) };
  }
  return resultado;
}

/**
 * Os rótulos que a falta põe na tela, e só eles: o aviso ("Sem conexão." ou
 * "Reconectando…"), a faixa com o que está na tela ("lista", "OS",
 * "demanda", "orçamento") e a hora, a frase do erro do servidor e o "Tentar
 * de novo". Nenhuma legenda, e o axe sem violação.
 */
export function rotulosDaFalta({ mensagem, objeto = "lista" }: { mensagem: string; objeto?: string }) {
  return {
    "sem nada lido, sem conexão": { novos: ["Sem conexão.", "Tentar de novo"], axe: [] },
    "sem nada lido, reconectando": { novos: ["Reconectando…", "Tentar de novo"], axe: [] },
    "lida, sem conexão": { novos: [`Sem conexão · ${objeto} de 10:42`, "Tentar de novo"], axe: [] },
    "lida, reconectando": { novos: ["Reconectando…", `· ${objeto} de 10:42`, "Tentar de novo"], axe: [] },
    "erro do servidor": { novos: [mensagem, "Tentar de novo"], axe: [] },
  };
}
