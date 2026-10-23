/**
 * A ficha do colaborador na tela (docs/plataforma/fase-8-rh.md, parte 8.2).
 *
 * O catálogo é cópia literal do de functions/rh/src/domain/ficha.ts, travada
 * pelo platform-lists.test.ts: mudou um, muda o outro. Aqui ficam também os
 * rótulos e a leitura do que as callables getRhPanel e getRhFicha devolvem.
 */

export const CATEGORIAS = ["documento", "exame", "treinamento"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const TIPOS_POR_CATEGORIA = {
  documento: ["rg", "cpf", "ctps", "pis", "titulo_de_eleitor", "reservista", "comprovante_de_residencia", "contrato_de_trabalho", "outro"],
  exame: ["admissional", "periodico", "retorno_ao_trabalho", "mudanca_de_funcao", "demissional", "outro"],
  treinamento: ["nr06", "nr10", "nr11", "nr12", "nr18", "nr35", "direcao_defensiva", "primeiros_socorros", "integracao", "outro"],
} as const satisfies Record<Categoria, readonly string[]>;

export const RESULTADOS_DO_EXAME = ["apto", "apto_com_restricao", "inapto"] as const;
export type ResultadoDoExame = (typeof RESULTADOS_DO_EXAME)[number];

export const SITUACOES = ["vigente", "substituido", "arquivado"] as const;
export type Situacao = (typeof SITUACOES)[number];

/** Quantos dias antes do vencimento o registro entra no Início do RH (a mesma janela da rotina). */
export const DIAS_PARA_O_VENCIMENTO = 30;

export const ROTULO_DA_CATEGORIA: Record<Categoria, string> = { documento: "Documentos", exame: "Exames", treinamento: "Treinamentos" };

export const ROTULO_DO_TIPO: Record<string, string> = {
  rg: "RG",
  cpf: "CPF",
  ctps: "CTPS",
  pis: "PIS",
  titulo_de_eleitor: "Título de eleitor",
  reservista: "Reservista",
  comprovante_de_residencia: "Comprovante de residência",
  contrato_de_trabalho: "Contrato de trabalho",
  admissional: "ASO admissional",
  periodico: "ASO periódico",
  retorno_ao_trabalho: "ASO de retorno ao trabalho",
  mudanca_de_funcao: "ASO de mudança de função",
  demissional: "ASO demissional",
  nr06: "NR-06 (EPI)",
  nr10: "NR-10 (eletricidade)",
  nr11: "NR-11 (movimentação de cargas)",
  nr12: "NR-12 (máquinas)",
  nr18: "NR-18 (construção)",
  nr35: "NR-35 (trabalho em altura)",
  direcao_defensiva: "Direção defensiva",
  primeiros_socorros: "Primeiros socorros",
  integracao: "Integração",
  outro: "Outro",
};

export const ROTULO_DO_RESULTADO: Record<ResultadoDoExame, string> = { apto: "Apto", apto_com_restricao: "Apto com restrição", inapto: "Inapto" };

export const ROTULO_DO_VINCULO: Record<string, string> = { proprio: "Própria", freelancer: "Freelancer", terceiro: "Terceiro" };

export type ColaboradorDoRh = { id: string; nome: string; funcao: string; vinculo: string; ativo: boolean };

export type ArquivoNaFicha = { id: string; content_type: string; tamanho: number };

export type RegistroDoRh = {
  id: string;
  colaborador_id: string;
  categoria: Categoria;
  tipo: string;
  descricao: string | null;
  emitido_em: string;
  vence_em: string | null;
  resultado: ResultadoDoExame | null;
  situacao: Situacao;
  substituido_por: string | null;
  arquivo: ArquivoNaFicha | null;
  edicao: number;
};

export type VencimentoDoRh = {
  registro_id: string;
  colaborador_id: string;
  nome: string;
  categoria: Categoria;
  tipo: string;
  descricao: string | null;
  vence_em: string;
  dias: number;
};

export type ColaboradorNoPainel = ColaboradorDoRh & { registros: number; vencendo: number; vencidos: number; proximo_vencimento: string | null };

export type PainelDoRh = { hoje: string; colaboradores: ColaboradorNoPainel[]; vencimentos: VencimentoDoRh[] };

export type FichaDoRh = { hoje: string; colaborador: ColaboradorDoRh; registros: RegistroDoRh[] };

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

function textoOuNull(valor: unknown): string | null {
  return typeof valor === "string" && valor ? valor : null;
}

function inteiro(valor: unknown): number {
  return typeof valor === "number" && Number.isFinite(valor) ? Math.trunc(valor) : 0;
}

function categoria(valor: unknown): Categoria | null {
  return (CATEGORIAS as readonly unknown[]).includes(valor) ? (valor as Categoria) : null;
}

function colaboradorLido(valor: unknown): ColaboradorDoRh | null {
  const dados = objeto(valor);
  if (!dados || typeof dados.id !== "string") return null;
  return { id: dados.id, nome: texto(dados.nome), funcao: texto(dados.funcao), vinculo: texto(dados.vinculo), ativo: dados.ativo === true };
}

function registroLido(valor: unknown): RegistroDoRh | null {
  const dados = objeto(valor);
  const cat = categoria(dados?.categoria);
  if (!dados || !cat || typeof dados.id !== "string" || typeof dados.tipo !== "string" || !DIA.test(texto(dados.emitido_em))) return null;
  const situacao = (SITUACOES as readonly unknown[]).includes(dados.situacao) ? (dados.situacao as Situacao) : null;
  if (!situacao) return null;
  const arquivo = objeto(dados.arquivo);
  const resultado = (RESULTADOS_DO_EXAME as readonly unknown[]).includes(dados.resultado) ? (dados.resultado as ResultadoDoExame) : null;
  const venceEm = textoOuNull(dados.vence_em);
  return {
    id: dados.id,
    colaborador_id: texto(dados.colaborador_id),
    categoria: cat,
    tipo: dados.tipo,
    descricao: textoOuNull(dados.descricao),
    emitido_em: texto(dados.emitido_em),
    vence_em: venceEm && DIA.test(venceEm) ? venceEm : null,
    resultado,
    situacao,
    substituido_por: textoOuNull(dados.substituido_por),
    arquivo: arquivo && typeof arquivo.id === "string" ? { id: arquivo.id, content_type: texto(arquivo.content_type), tamanho: inteiro(arquivo.tamanho) } : null,
    edicao: inteiro(dados.edicao),
  };
}

function vencimentoLido(valor: unknown): VencimentoDoRh | null {
  const dados = objeto(valor);
  const cat = categoria(dados?.categoria);
  if (!dados || !cat || typeof dados.registro_id !== "string" || typeof dados.colaborador_id !== "string" || !DIA.test(texto(dados.vence_em))) return null;
  return {
    registro_id: dados.registro_id,
    colaborador_id: dados.colaborador_id,
    nome: texto(dados.nome),
    categoria: cat,
    tipo: texto(dados.tipo),
    descricao: textoOuNull(dados.descricao),
    vence_em: texto(dados.vence_em),
    dias: inteiro(dados.dias),
  };
}

/** O que getRhPanel devolve; null quando não é o painel. */
export function painelLido(valor: unknown): PainelDoRh | null {
  const dados = objeto(valor);
  if (!dados || !DIA.test(texto(dados.hoje)) || !Array.isArray(dados.colaboradores) || !Array.isArray(dados.vencimentos)) return null;
  const colaboradores = dados.colaboradores.flatMap((item): ColaboradorNoPainel[] => {
    const colaborador = colaboradorLido(item);
    const extra = objeto(item);
    if (!colaborador || !extra) return [];
    return [{ ...colaborador, registros: inteiro(extra.registros), vencendo: inteiro(extra.vencendo), vencidos: inteiro(extra.vencidos), proximo_vencimento: textoOuNull(extra.proximo_vencimento) }];
  });
  const vencimentos = dados.vencimentos.flatMap((item) => {
    const vencimento = vencimentoLido(item);
    return vencimento ? [vencimento] : [];
  });
  return { hoje: texto(dados.hoje), colaboradores, vencimentos };
}

/** O que getRhFicha devolve; null quando não é a ficha. */
export function fichaLida(valor: unknown): FichaDoRh | null {
  const dados = objeto(valor);
  const colaborador = colaboradorLido(dados?.colaborador);
  if (!dados || !colaborador || !DIA.test(texto(dados.hoje)) || !Array.isArray(dados.registros)) return null;
  const registros = dados.registros.flatMap((item) => {
    const registro = registroLido(item);
    return registro ? [registro] : [];
  });
  return { hoje: texto(dados.hoje), colaborador, registros };
}

/** O nome do registro: o rótulo do tipo, ou o nome que o "outro" leva. */
export function nomeDoRegistro(registro: Pick<RegistroDoRh, "tipo" | "descricao">): string {
  if (registro.tipo === "outro") return registro.descricao ?? ROTULO_DO_TIPO.outro;
  return ROTULO_DO_TIPO[registro.tipo] ?? registro.tipo;
}

const UM_DIA_MS = 86_400_000;

/** Dias corridos de `de` até `ate` (AAAA-MM-DD); negativo quando `ate` já passou. */
export function diasAte(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / UM_DIA_MS);
}

/** "vence hoje", "vence em 9 dias", "venceu há 22 dias": o prazo como dado. */
export function textoDoPrazo(dias: number): string {
  if (dias === 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  if (dias > 1) return `vence em ${dias} dias`;
  if (dias === -1) return "venceu ontem";
  return `venceu há ${-dias} dias`;
}
