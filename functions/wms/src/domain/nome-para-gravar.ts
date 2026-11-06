import { HttpsError } from "firebase-functions/v2/https";

import { padronizarNome, problemaDoNome } from "./nome-do-produto.js";

/**
 * O nome e o tamanho que o cadastro grava num produto novo ou num nome
 * editado, pelo padrão decidido em 06/11/2026 (nome-do-produto.ts, cópia de
 * lib/dominio; ferramenta e roteiro em tools/padronizar-nomes).
 *
 * O padrão corrige sozinho a caixa das letras, o gênero (etiqueta
 * "Masculino"/"Feminino"), os espaços, a cor composta e o tamanho do próprio
 * produto no fim do nome; o tamanho vem do fim do código e, sem ele, do campo
 * Tamanho. Com `recusa` (a equipe, o Catálogo e a API), o que contradiz o
 * código (outro tamanho no nome ou no campo Tamanho) e o nome que é só o
 * tamanho param com a mesma frase das telas. Com `corrige` (o que o cliente
 * digitou no portal), vale o código e nada para.
 */
export type ModoDoNome = "recusa" | "corrige";

export type NomeParaGravar = { nome: string; tamanho: string | undefined };

export type EntradaParaGravar = { nome: unknown; codigo?: unknown; genero?: unknown; tamanho?: unknown };

const texto = (valor: unknown) => String(valor ?? "").trim();

export function nomeParaGravar(entrada: EntradaParaGravar, modo: ModoDoNome = "recusa"): NomeParaGravar {
  const nome = texto(entrada.nome);
  const produto = { nome, codigo: texto(entrada.codigo), genero: texto(entrada.genero), tamanho: texto(entrada.tamanho) };
  if (modo === "recusa") {
    const problema = problemaDoNome(produto);
    if (problema && problema.tipo !== "tamanho_no_nome") {
      throw new HttpsError("invalid-argument", problema.mensagem, { code: "PRODUCT_NAME_SIZE", tipo: problema.tipo });
    }
  }
  const padrao = padronizarNome(produto);
  return { nome: padrao.nome || nome, tamanho: padrao.tamanho ?? undefined };
}
