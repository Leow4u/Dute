import type { ItemDoCatalogo } from "../operacao/demanda-direta";
import type { FichaDaOs, FotoLida } from "../operacao/ficha-da-os";
import type { NovoRegistro, RegistroNaFila } from "./fila";

/**
 * A vistoria no celular (docs/plataforma/fase-3-operacao.md, parte 3.11b;
 * docs/mockups/Campo2Vistoria.dc.html). O líder levanta, por ambiente, as
 * fotos e os itens do catálogo, e depois as medidas, o acesso e as
 * observações. O que ele levanta fica num rascunho guardado no aparelho
 * (sobrevive a recarregar a página e à falta de sinal) até a vistoria ir ao
 * Comercial. As fotos vão pela fila do campo assim que são tiradas, com o
 * nome do ambiente na legenda; o envio (sendSurveyToCommercial) vai pela
 * mesma fila, depois delas, e cita as fotos de cada ambiente. Sem valor.
 */

export type ItemNoRascunho = { lpuItemId: string; item: string; unidade: string | null; quantidade: number };

export type AmbienteNoRascunho = { id: string; nome: string; itens: ItemNoRascunho[]; fotos: string[]; feito: boolean };

/** A medida sugerida tem o nome fixo; a nova, o nome digitado. */
export type MedidaNoRascunho = { id: string; nome: string; valor: string; sugerida: boolean };

export type RascunhoDaVistoria = {
  ambientes: AmbienteNoRascunho[];
  /** O ambiente em que o líder está (id), ou null. */
  atual: string | null;
  medidas: MedidaNoRascunho[];
  horarioDeCarga: string;
  vagaDeCarga: string;
  observacoes: string;
};

/** As medidas que toda vistoria pergunta. */
export const MEDIDAS_SUGERIDAS = ["Elevador de serviço", "Carga do elevador", "Porta"] as const;

/** Os limites do servidor (functions/operacao, domain/vistoria.ts). */
export const MAX_AMBIENTES = 30;
export const MAX_ITENS_POR_AMBIENTE = 100;
export const MAX_FOTOS_POR_AMBIENTE = 50;
export const MAX_MEDIDAS = 30;
export const MAX_NOME = 60;

export function rascunhoInicial(): RascunhoDaVistoria {
  return {
    ambientes: [],
    atual: null,
    medidas: MEDIDAS_SUGERIDAS.map((nome, indice) => ({ id: `md_sugerida_${indice + 1}`, nome, valor: "", sugerida: true })),
    horarioDeCarga: "",
    vagaDeCarga: "",
    observacoes: "",
  };
}

function chaveDoNome(nome: string): string {
  return nome.trim().replace(/\s+/g, " ").normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

// --- Ambientes -----------------------------------------------------------------------------

/** Por que o nome não serve para um ambiente novo, ou null. */
export function problemaDoNomeDoAmbiente(rascunho: Pick<RascunhoDaVistoria, "ambientes">, nome: string): string | null {
  const limpo = nome.trim();
  if (!limpo) return "Informe o nome do ambiente.";
  if (limpo.length > MAX_NOME) return `Use até ${MAX_NOME} caracteres no nome do ambiente.`;
  if (rascunho.ambientes.some((ambiente) => chaveDoNome(ambiente.nome) === chaveDoNome(limpo))) return `O ambiente ${limpo} já está na vistoria.`;
  if (rascunho.ambientes.length >= MAX_AMBIENTES) return `A vistoria passa de ${MAX_AMBIENTES} ambientes.`;
  return null;
}

/** Um ambiente novo, que passa a ser o atual. */
export function comAmbiente(rascunho: RascunhoDaVistoria, nome: string, id: string): RascunhoDaVistoria {
  const ambiente: AmbienteNoRascunho = { id, nome: nome.trim().replace(/\s+/g, " "), itens: [], fotos: [], feito: false };
  return { ...rascunho, ambientes: [...rascunho.ambientes, ambiente], atual: id };
}

function noAmbiente(rascunho: RascunhoDaVistoria, id: string, muda: (ambiente: AmbienteNoRascunho) => AmbienteNoRascunho): RascunhoDaVistoria {
  return { ...rascunho, ambientes: rascunho.ambientes.map((ambiente) => (ambiente.id === id ? muda(ambiente) : ambiente)) };
}

export function comAtual(rascunho: RascunhoDaVistoria, id: string): RascunhoDaVistoria {
  return rascunho.ambientes.some((ambiente) => ambiente.id === id) ? { ...rascunho, atual: id } : rascunho;
}

/** Concluir o ambiente leva ao próximo que ainda não foi feito; reabrir o deixa como atual. */
export function comFeito(rascunho: RascunhoDaVistoria, id: string, feito: boolean): RascunhoDaVistoria {
  const marcado = noAmbiente(rascunho, id, (ambiente) => ({ ...ambiente, feito }));
  if (!feito) return { ...marcado, atual: id };
  const proximo = marcado.ambientes.find((ambiente) => !ambiente.feito);
  return { ...marcado, atual: proximo?.id ?? id };
}

/** Um item do catálogo no ambiente: entra com 1, ou soma 1 se já está. */
export function comItem(rascunho: RascunhoDaVistoria, ambienteId: string, item: ItemDoCatalogo): RascunhoDaVistoria {
  return noAmbiente(rascunho, ambienteId, (ambiente) => {
    if (ambiente.itens.some((existente) => existente.lpuItemId === item.id)) {
      return { ...ambiente, itens: ambiente.itens.map((existente) => (existente.lpuItemId === item.id ? { ...existente, quantidade: existente.quantidade + 1 } : existente)) };
    }
    if (ambiente.itens.length >= MAX_ITENS_POR_AMBIENTE) return ambiente;
    return { ...ambiente, itens: [...ambiente.itens, { lpuItemId: item.id, item: item.item, unidade: item.unidade, quantidade: 1 }] };
  });
}

/** + e − no item: a quantidade é inteira; chegando a zero, o item sai do ambiente. */
export function comQuantidade(rascunho: RascunhoDaVistoria, ambienteId: string, lpuItemId: string, delta: 1 | -1): RascunhoDaVistoria {
  return noAmbiente(rascunho, ambienteId, (ambiente) => ({
    ...ambiente,
    itens: ambiente.itens.flatMap((item) => {
      if (item.lpuItemId !== lpuItemId) return [item];
      const quantidade = Math.max(0, Math.round(item.quantidade) + delta);
      return quantidade > 0 ? [{ ...item, quantidade }] : [];
    }),
  }));
}

/** As fotos tiradas no ambiente (os ids das fotos da OS: ft_ e 16 hexadecimais). */
export function comFotos(rascunho: RascunhoDaVistoria, ambienteId: string, ids: readonly string[]): RascunhoDaVistoria {
  return noAmbiente(rascunho, ambienteId, (ambiente) => ({ ...ambiente, fotos: [...ambiente.fotos, ...ids.filter((id) => !ambiente.fotos.includes(id))] }));
}

/**
 * Sem as fotos que o servidor recusou (a fila desistiu delas): nunca chegam à
 * OS, e o envio da vistoria com elas é recusado sempre. O mesmo rascunho
 * quando nenhuma está nele.
 */
export function semFotosRecusadas(rascunho: RascunhoDaVistoria, recusadas: ReadonlySet<string>): RascunhoDaVistoria {
  if (!rascunho.ambientes.some((ambiente) => ambiente.fotos.some((id) => recusadas.has(id)))) return rascunho;
  return { ...rascunho, ambientes: rascunho.ambientes.map((ambiente) => ({ ...ambiente, fotos: ambiente.fotos.filter((id) => !recusadas.has(id)) })) };
}

export type SituacaoDoAmbiente = "Feito" | "Em andamento" | "A fazer";

export function situacaoDoAmbiente(ambiente: AmbienteNoRascunho, atual: string | null): SituacaoDoAmbiente {
  if (ambiente.feito) return "Feito";
  if (ambiente.id === atual || ambiente.fotos.length || ambiente.itens.length) return "Em andamento";
  return "A fazer";
}

/** "2 de 4 feitos", ou null sem ambiente. */
export function feitosEmTexto(rascunho: Pick<RascunhoDaVistoria, "ambientes">): string | null {
  if (!rascunho.ambientes.length) return null;
  const feitos = rascunho.ambientes.filter((ambiente) => ambiente.feito).length;
  return `${feitos} de ${rascunho.ambientes.length} ${rascunho.ambientes.length === 1 ? "feito" : "feitos"}`;
}

/** "8 fotos", "1 foto". */
export function fotosEmTexto(quantas: number): string {
  return `${quantas} ${quantas === 1 ? "foto" : "fotos"}`;
}

// --- Medidas, acesso e observações ---------------------------------------------------------

export function comNovaMedida(rascunho: RascunhoDaVistoria, id: string): RascunhoDaVistoria {
  if (rascunho.medidas.length >= MAX_MEDIDAS) return rascunho;
  return { ...rascunho, medidas: [...rascunho.medidas, { id, nome: "", valor: "", sugerida: false }] };
}

export function comMedida(rascunho: RascunhoDaVistoria, id: string, campo: "nome" | "valor", valor: string): RascunhoDaVistoria {
  return {
    ...rascunho,
    medidas: rascunho.medidas.map((medida) => (medida.id === id && !(campo === "nome" && medida.sugerida) ? { ...medida, [campo]: valor } : medida)),
  };
}

/** Só a medida nova sai; a sugerida fica (sem valor, não vai). */
export function semMedida(rascunho: RascunhoDaVistoria, id: string): RascunhoDaVistoria {
  return { ...rascunho, medidas: rascunho.medidas.filter((medida) => medida.id !== id || medida.sugerida) };
}

// --- A situação na OS ----------------------------------------------------------------------

function textoDe(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

function pendentesDa(ficha: Pick<FichaDaOs, "numero">, pendentes: readonly RegistroNaFila[]): RegistroNaFila[] {
  return pendentes.filter((registro) => registro.dados.numero === ficha.numero);
}

/** A chegada gravada ou guardada na fila (o envio pede a OS em execução), ou null. */
export function chegadaDaVistoria(ficha: Pick<FichaDaOs, "numero" | "etapas">, pendentes: readonly RegistroNaFila[]): string | null {
  const gravada = ficha.etapas.find((etapa) => etapa.etapa === "chegada_origem")?.instante;
  if (gravada) return gravada;
  const guardada = pendentesDa(ficha, pendentes).find((registro) => registro.callable === "registerStep" && registro.dados.etapa === "chegada_origem");
  return guardada ? textoDe(guardada.dados.instante) || null : null;
}

/** O envio da vistoria que ainda está na fila, ou null. */
export function vistoriaGuardada(ficha: Pick<FichaDaOs, "numero">, pendentes: readonly RegistroNaFila[]): RegistroNaFila | null {
  return pendentesDa(ficha, pendentes).find((registro) => registro.callable === "sendSurveyToCommercial") ?? null;
}

/** O líder da equipe, quando há: pelo celular, só ele envia a vistoria (o servidor confere). */
export function liderDaVistoria(ficha: Pick<FichaDaOs, "equipe">): FichaDaOs["equipe"][number] | null {
  return ficha.equipe.find((pessoa) => pessoa.papel === "lider") ?? null;
}

/** Quem está no celular faz a vistoria: o líder, ou qualquer um da equipe quando ela não tem líder. */
export function fazAVistoria(ficha: Pick<FichaDaOs, "equipe">, uid: string | null | undefined): boolean {
  if (!uid) return false;
  const eu = ficha.equipe.find((pessoa) => pessoa.uid === uid);
  if (!eu) return false;
  const lider = liderDaVistoria(ficha);
  return !lider || lider.id === eu.id;
}

export type FotoDoAmbiente = { id: string; foto: FotoLida | null; guardada: RegistroNaFila | null };

/** As fotos do ambiente: a gravada na OS ou a que ainda está na fila. */
export function fotosDoAmbiente(ambiente: AmbienteNoRascunho, ficha: Pick<FichaDaOs, "numero" | "fotos">, pendentes: readonly RegistroNaFila[]): FotoDoAmbiente[] {
  const naFila = pendentesDa(ficha, pendentes).filter((registro) => registro.callable === "attachPhoto");
  return ambiente.fotos.map((id) => ({
    id,
    foto: ficha.fotos.find((foto) => foto.id === id) ?? null,
    guardada: naFila.find((registro) => textoDe(registro.dados.arquivo).replace(/\.[a-z]+$/, "") === id) ?? null,
  }));
}

// --- O envio -------------------------------------------------------------------------------

/** O que falta para enviar a vistoria (vazio: pode enviar). */
export function problemasDaVistoria(rascunho: RascunhoDaVistoria, contexto: { chegou: boolean }): string[] {
  const problemas: string[] = [];
  if (!contexto.chegou) problemas.push("Registre a chegada antes de enviar a vistoria.");
  if (!rascunho.ambientes.length) problemas.push("Levante ao menos um ambiente.");
  if (!rascunho.ambientes.some((ambiente) => ambiente.fotos.length)) problemas.push("Tire ao menos uma foto da vistoria.");
  if (!rascunho.ambientes.some((ambiente) => ambiente.itens.some((item) => item.quantidade > 0))) problemas.push("Levante ao menos um item do catálogo.");
  for (const ambiente of rascunho.ambientes) {
    if (ambiente.fotos.length > MAX_FOTOS_POR_AMBIENTE) problemas.push(`${ambiente.nome}: use até ${MAX_FOTOS_POR_AMBIENTE} fotos.`);
  }
  const preenchidas = rascunho.medidas.filter((medida) => medida.nome.trim() || medida.valor.trim());
  if (preenchidas.some((medida) => !medida.nome.trim())) problemas.push("Dê nome a cada medida.");
  const nomes = new Set<string>();
  for (const medida of preenchidas) {
    const chave = chaveDoNome(medida.nome);
    if (chave && nomes.has(chave)) problemas.push(`A medida ${medida.nome.trim()} aparece duas vezes.`);
    nomes.add(chave);
  }
  return problemas;
}

function textoOuNull(valor: string): string | null {
  const limpo = valor.trim().replace(/\s+/g, " ");
  return limpo || null;
}

/** O envio ao Comercial, no formato de sendSurveyToCommercial. A medida sem valor não vai. */
export function registroDaVistoria(ficha: Pick<FichaDaOs, "numero">, rascunho: RascunhoDaVistoria, agora: Date): NovoRegistro {
  return {
    callable: "sendSurveyToCommercial",
    dados: {
      numero: ficha.numero,
      instante: agora.toISOString(),
      ambientes: rascunho.ambientes.map((ambiente) => ({
        nome: ambiente.nome,
        itens: ambiente.itens.filter((item) => item.quantidade > 0).map((item) => ({ lpu_item_id: item.lpuItemId, quantidade: String(Math.round(item.quantidade)) })),
        fotos: ambiente.fotos,
      })),
      medidas: rascunho.medidas
        .filter((medida) => medida.nome.trim() && medida.valor.trim())
        .map((medida) => ({ nome: medida.nome.trim().replace(/\s+/g, " "), valor: medida.valor.trim().replace(/\s+/g, " ") })),
      acesso: { horario_de_carga: textoOuNull(rascunho.horarioDeCarga), vaga_de_carga: textoOuNull(rascunho.vagaDeCarga) },
      observacoes: rascunho.observacoes.trim() || null,
    },
    rotulo: "Vistoria",
  };
}

// --- O rascunho no aparelho ----------------------------------------------------------------

const PREFIXO = "dute:campo:vistoria:";

type Armazenamento = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** O armazenamento do navegador, ou null quando ele não existe ou está bloqueado. */
export function armazenamentoDoAparelho(): Armazenamento | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function lista(valor: unknown): Record<string, unknown>[] {
  return Array.isArray(valor) ? valor.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

/** O rascunho guardado, conferido campo a campo; o que não se lê volta como o inicial. */
export function rascunhoLido(valor: unknown): RascunhoDaVistoria | null {
  if (!valor || typeof valor !== "object") return null;
  const bruto = valor as Record<string, unknown>;
  const ambientes = lista(bruto.ambientes).flatMap((ambiente): AmbienteNoRascunho[] => {
    const id = textoDe(ambiente.id);
    const nome = textoDe(ambiente.nome).trim();
    if (!id || !nome) return [];
    return [
      {
        id,
        nome,
        feito: ambiente.feito === true,
        fotos: Array.isArray(ambiente.fotos) ? ambiente.fotos.filter((foto): foto is string => typeof foto === "string" && /^ft_[a-f0-9]{16}$/.test(foto)) : [],
        itens: lista(ambiente.itens).flatMap((item): ItemNoRascunho[] => {
          const quantidade = Number(item.quantidade);
          if (!textoDe(item.lpuItemId) || !textoDe(item.item) || !Number.isInteger(quantidade) || quantidade <= 0) return [];
          return [{ lpuItemId: textoDe(item.lpuItemId), item: textoDe(item.item), unidade: textoDe(item.unidade) || null, quantidade }];
        }),
      },
    ];
  });
  const medidas = lista(bruto.medidas).flatMap((medida): MedidaNoRascunho[] =>
    textoDe(medida.id) ? [{ id: textoDe(medida.id), nome: textoDe(medida.nome), valor: textoDe(medida.valor), sugerida: medida.sugerida === true }] : [],
  );
  const atual = textoDe(bruto.atual);
  return {
    ambientes,
    atual: ambientes.some((ambiente) => ambiente.id === atual) ? atual : null,
    medidas: medidas.length ? medidas : rascunhoInicial().medidas,
    horarioDeCarga: textoDe(bruto.horarioDeCarga),
    vagaDeCarga: textoDe(bruto.vagaDeCarga),
    observacoes: textoDe(bruto.observacoes),
  };
}

export function lerRascunho(numero: string, armazenamento: Armazenamento | null = armazenamentoDoAparelho()): RascunhoDaVistoria | null {
  try {
    const texto = armazenamento?.getItem(`${PREFIXO}${numero}`);
    return texto ? rascunhoLido(JSON.parse(texto)) : null;
  } catch {
    return null;
  }
}

export function guardarRascunho(numero: string, rascunho: RascunhoDaVistoria, armazenamento: Armazenamento | null = armazenamentoDoAparelho()): void {
  try {
    armazenamento?.setItem(`${PREFIXO}${numero}`, JSON.stringify(rascunho));
  } catch {
    // Sem espaço ou bloqueado: o rascunho fica só na tela até a vistoria ir.
  }
}

/** Tira do rascunho guardado da OS as fotos que o servidor recusou, com a tela da vistoria aberta ou não. */
export function tirarFotosRecusadas(numero: string, recusadas: ReadonlySet<string>, armazenamento: Armazenamento | null = armazenamentoDoAparelho()): void {
  const rascunho = lerRascunho(numero, armazenamento);
  if (!rascunho) return;
  const semElas = semFotosRecusadas(rascunho, recusadas);
  if (semElas !== rascunho) guardarRascunho(numero, semElas, armazenamento);
}

export function apagarRascunho(numero: string, armazenamento: Armazenamento | null = armazenamentoDoAparelho()): void {
  try {
    armazenamento?.removeItem(`${PREFIXO}${numero}`);
  } catch {
    // Nada a fazer.
  }
}
