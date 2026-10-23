import type { CallableDaOperacao } from "./api";
import { instanteDeSaoPaulo, quantidadeDigitada } from "./demanda-direta";
import { ETAPAS_DA_OS, ETAPA_ROTULO, type EtapaDaOs, type FichaDaOs, type MeioDoEscritorio } from "./ficha-da-os";
import { hojeIso } from "./fila";
import { milesimos } from "./hoje";

/**
 * "Registrar andamento" na ficha da OS (docs/plataforma/fase-3-operacao.md,
 * parte 3.7e; docs/mockups/OpOS.dc.html): o escritório registra a etapa, o
 * feito dos itens (e o que passou do planejado) e a ocorrência com fotos,
 * no formato das callables da parte 3.7. A tela confere antes; a callable
 * confere de novo. Sem valor.
 */

export const TIPOS_DE_ANDAMENTO = ["etapa", "itens", "ocorrencia", "conclusao"] as const;
export type TipoDeAndamento = (typeof TIPOS_DE_ANDAMENTO)[number];
export const TIPO_DE_ANDAMENTO_ROTULO: Record<TipoDeAndamento, string> = { etapa: "Etapa", itens: "Itens", ocorrencia: "Ocorrência", conclusao: "Conclusão" };

/** O que se registra pelo escritório: na vistoria (parte 3.11d), só a etapa e a ocorrência; ela vai ao Comercial pelo celular. */
export function tiposDeAndamento(ficha: Pick<FichaDaOs, "tipo">): readonly TipoDeAndamento[] {
  return ficha.tipo === "vistoria" ? ["etapa", "ocorrencia"] : TIPOS_DE_ANDAMENTO;
}

/** As etapas da vistoria que o escritório registra: ir e chegar (o Fim vem com o envio ao Comercial). */
export const ETAPAS_DA_VISTORIA_NO_ESCRITORIO = ["saida_patio", "chegada_origem"] as const satisfies readonly EtapaDaOs[];

/** O aceite da conclusão (parte 3.9c): a via assinada no papel (a foto dela é a assinatura) ou sem aceite no local. */
export type AceiteDoEscritorio = "assinatura" | "sem_aceite";

/** O item que passou do planejado: uma linha da OS ou um item avulso. */
export type InclusaoNoFormulario = { linha: string; item: string; unidade: string; quantidade: string; pedidoPor: string; motivo: string };

export const AVULSO = "avulso";

export type FormularioDeAndamento = {
  tipo: TipoDeAndamento;
  etapa: EtapaDaOs | "";
  data: string;
  hora: string;
  informadoPor: string;
  meio: MeioDoEscritorio | "";
  /** O feito de cada linha, como digitado. */
  feitos: Record<string, string>;
  inclusao: InclusaoNoFormulario | null;
  descricao: string;
  /** A conclusão (parte 3.9c). */
  aceite: AceiteDoEscritorio;
  nome: string;
  cargo: string;
  documento: string;
  /** O motivo por linha a menos. */
  motivos: Record<string, string>;
};

/** O que vai anexado à conclusão: quantas fotos do final foram escolhidas e o nome da assinatura no Storage. */
export type AnexosDaConclusao = { fotosDoFinal: number; assinatura: string | null };

/** Quanto o relógio pode estar adiantado (o mesmo da callable). */
const TOLERANCIA_MS = 5 * 60_000;
const QUANTIDADE = /^\d{1,9}(\.\d{1,3})?$/;

function horaAgora(agora: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(agora);
}

/** As etapas que ainda se registram: as que vêm depois da última registrada (na vistoria, só ir e chegar). */
export function etapasPossiveis(ficha: Pick<FichaDaOs, "etapas"> & Partial<Pick<FichaDaOs, "tipo">>): EtapaDaOs[] {
  const ultima = ficha.etapas.at(-1);
  const depois = ultima ? ETAPAS_DA_OS.indexOf(ultima.etapa) + 1 : 0;
  const seguintes = ETAPAS_DA_OS.slice(depois);
  return ficha.tipo === "vistoria" ? seguintes.filter((etapa) => (ETAPAS_DA_VISTORIA_NO_ESCRITORIO as readonly string[]).includes(etapa)) : seguintes;
}

export function andamentoInicial(ficha: FichaDaOs, agora: Date): FormularioDeAndamento {
  const lider = ficha.equipe.find((pessoa) => pessoa.papel === "lider");
  return {
    tipo: "etapa",
    etapa: etapasPossiveis(ficha)[0] ?? "",
    data: hojeIso(agora),
    hora: horaAgora(agora),
    informadoPor: lider?.id ?? "",
    meio: "telefone",
    feitos: Object.fromEntries(ficha.itens.map((item) => [item.id, item.executado ?? "0"])),
    inclusao: null,
    descricao: "",
    aceite: "assinatura",
    nome: ficha.locais.destino?.contato?.nome ?? ficha.locais.origem?.contato?.nome ?? "",
    cargo: "",
    documento: "",
    motivos: {},
  };
}

export function inclusaoVazia(ficha: Pick<FichaDaOs, "itens">): InclusaoNoFormulario {
  return { linha: ficha.itens[0]?.id ?? AVULSO, item: "", unidade: "", quantidade: "", pedidoPor: "", motivo: "" };
}

function previsto(item: FichaDaOs["itens"][number]): number {
  return milesimos(item.planejado) + item.incluidos.reduce((soma, inclusao) => soma + milesimos(inclusao.quantidade), 0);
}

/** As linhas cujo feito mudou, com o feito digitado. */
export function feitosAlterados(form: Pick<FormularioDeAndamento, "feitos">, ficha: Pick<FichaDaOs, "itens">): Array<{ linha: string; executado: string }> {
  return ficha.itens.flatMap((item) => {
    const digitado = quantidadeDigitada(form.feitos[item.id] ?? "");
    if (!digitado || digitado === (item.executado ?? "0")) return [];
    if (QUANTIDADE.test(digitado) && QUANTIDADE.test(item.executado ?? "0") && milesimos(digitado) === milesimos(item.executado ?? "0")) return [];
    return [{ linha: item.id, executado: digitado }];
  });
}

/** Os itens feitos a menos que o previsto: a conclusão pede o motivo de cada um. */
export function itensAMenos(ficha: Pick<FichaDaOs, "itens">): Array<{ id: string; item: string; feito: number; previsto: number }> {
  return ficha.itens.flatMap((item) => {
    const feito = item.executado ? milesimos(item.executado) : 0;
    const limite = previsto(item);
    return feito < limite ? [{ id: item.id, item: item.item, feito, previsto: limite }] : [];
  });
}

/** Quantas fotos do final (etapa Fim) a OS já tem. */
export function fotosDoFinalNaOs(ficha: Pick<FichaDaOs, "fotos">): number {
  return ficha.fotos.filter((foto) => foto.etapa === "fim").length;
}

function problemasDaHora(form: FormularioDeAndamento, ficha: FichaDaOs, agora: Date): string[] {
  const instante = instanteDeSaoPaulo(form.data, form.hora);
  if (!instante) return ["Informe a data e a hora."];
  if (Date.parse(instante) > agora.getTime() + TOLERANCIA_MS) return ["A hora informada ainda não chegou."];
  if (ficha.janela && form.data < ficha.janela.data) return ["A data é de antes do dia da OS."];
  return [];
}

/** O que impede registrar; a lista vazia libera. */
export function problemasDoAndamento(
  form: FormularioDeAndamento,
  ficha: FichaDaOs,
  agora: Date,
  anexos: AnexosDaConclusao = { fotosDoFinal: 0, assinatura: null },
): string[] {
  const problemas: string[] = [];
  if (ficha.status !== "agendada" && ficha.status !== "em_execucao") return ["A OS não recebe andamento."];
  if (form.tipo === "etapa") {
    if (!form.etapa) problemas.push("Escolha a etapa.");
    problemas.push(...problemasDaHora(form, ficha, agora));
    if (ficha.status === "agendada" && ficha.equipe.length === 0) problemas.push("Escale a equipe antes de iniciar a OS.");
    return problemas;
  }
  if (form.tipo === "conclusao") {
    if (ficha.status !== "em_execucao") return ["Registre a primeira etapa antes de concluir."];
    const daHora = problemasDaHora(form, ficha, agora);
    problemas.push(...daHora);
    const ultima = ficha.etapas.at(-1);
    const instante = instanteDeSaoPaulo(form.data, form.hora);
    if (!daHora.length && ultima && instante && Date.parse(instante) < Date.parse(ultima.instante)) problemas.push(`A hora vem antes de ${ETAPA_ROTULO[ultima.etapa]}.`);
    for (const item of itensAMenos(ficha)) {
      if ((form.motivos[item.id] ?? "").trim().length < 3) problemas.push(`Informe o motivo da diferença em ${item.item}.`);
    }
    if (fotosDoFinalNaOs(ficha) + anexos.fotosDoFinal === 0) problemas.push("Anexe ao menos uma foto do final.");
    if (form.nome.trim().length < 2) problemas.push(form.aceite === "assinatura" ? "Informe o nome do responsável." : "Informe quem recebeu.");
    if (form.aceite === "assinatura" && !anexos.assinatura) problemas.push("Anexe a foto da via assinada.");
    return problemas;
  }
  if (form.tipo === "itens") {
    if (ficha.status !== "em_execucao") return ["Registre a primeira etapa antes dos itens."];
    for (const item of ficha.itens) {
      const digitado = quantidadeDigitada(form.feitos[item.id] ?? "");
      if (!digitado) continue;
      if (!QUANTIDADE.test(digitado)) problemas.push(`${item.item}: a quantidade está fora do formato.`);
      else if (milesimos(digitado) > previsto(item)) problemas.push(`${item.item}: o feito passa do previsto. Inclua o que foi além do planejado.`);
    }
    const inclusao = form.inclusao;
    if (inclusao) {
      if (inclusao.linha === AVULSO && (inclusao.item.trim().length < 2 || !inclusao.unidade.trim())) problemas.push("Item avulso: informe o nome e a unidade.");
      const quantidade = quantidadeDigitada(inclusao.quantidade);
      if (!QUANTIDADE.test(quantidade) || milesimos(quantidade) <= 0) problemas.push("Informe a quantidade além do planejado.");
      if (inclusao.pedidoPor.trim().length < 2) problemas.push("Informe quem pediu no local.");
      if (inclusao.motivo.trim().length < 3) problemas.push("Informe o motivo.");
    }
    if (!problemas.length && !inclusao && !feitosAlterados(form, ficha).length) problemas.push("Nenhum feito mudou.");
    return problemas;
  }
  if (form.descricao.trim().length < 3) problemas.push("Descreva a ocorrência.");
  return problemas;
}

export type PedidoDeAndamento = { callable: CallableDaOperacao; dados: Record<string, unknown> };

function origem(form: FormularioDeAndamento) {
  return { informado_por: form.informadoPor || null, meio: form.meio || null };
}

/**
 * As chamadas, na ordem: a etapa; ou o feito de cada linha que mudou e a
 * inclusão; ou a ocorrência. Cada uma com a chave derivada da tentativa
 * (repetir a tentativa não duplica).
 */
export function pedidosDoAndamento(form: FormularioDeAndamento, ficha: FichaDaOs, chave: string, agora: Date, assinatura: string | null = null): PedidoDeAndamento[] {
  const numero = ficha.numero;
  if (form.tipo === "conclusao") {
    const comAssinatura = form.aceite === "assinatura";
    const cargo = form.cargo.trim();
    const documento = form.documento.trim();
    return [
      {
        callable: "completeServiceOrder",
        dados: {
          idempotency_key: chave,
          numero,
          instante: instanteDeSaoPaulo(form.data, form.hora),
          aceite: form.aceite,
          responsavel: { nome: form.nome.trim(), ...(comAssinatura && cargo ? { cargo } : {}), ...(comAssinatura && documento ? { documento } : {}) },
          ...(comAssinatura && assinatura ? { assinatura } : {}),
          diferencas: itensAMenos(ficha).map((item) => ({ linha: item.id, motivo: (form.motivos[item.id] ?? "").trim() })),
          ...origem(form),
        },
      },
    ];
  }
  if (form.tipo === "etapa") {
    return [
      {
        callable: "registerStep",
        dados: { idempotency_key: chave, numero, etapa: form.etapa, instante: instanteDeSaoPaulo(form.data, form.hora), ...origem(form) },
      },
    ];
  }
  const instante = agora.toISOString();
  if (form.tipo === "itens") {
    const pedidos: PedidoDeAndamento[] = feitosAlterados(form, ficha).map(({ linha, executado }) => ({
      callable: "registerItem",
      dados: { action: "executed", idempotency_key: `${chave}:${linha}`, numero, linha, executado, instante, ...origem(form) },
    }));
    const inclusao = form.inclusao;
    if (inclusao) {
      pedidos.push({
        callable: "registerItem",
        dados: {
          action: "added",
          idempotency_key: `${chave}:inclusao`,
          numero,
          ...(inclusao.linha === AVULSO ? { item: inclusao.item.trim(), unidade: inclusao.unidade.trim().toUpperCase() } : { linha: inclusao.linha }),
          quantidade: quantidadeDigitada(inclusao.quantidade),
          pedido_por: inclusao.pedidoPor.trim(),
          motivo: inclusao.motivo.trim(),
          instante,
          ...origem(form),
        },
      });
    }
    return pedidos;
  }
  return [{ callable: "registerOccurrence", dados: { idempotency_key: chave, numero, descricao: form.descricao.trim(), instante, ...origem(form) } }];
}

/** "Saída do pátio" etc., para o select. */
export function rotuloDaEtapa(etapa: EtapaDaOs): string {
  return ETAPA_ROTULO[etapa];
}

// --- Fotos --------------------------------------------------------------------------------

const EXTENSAO: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const MAX_FOTO_BYTES = 8 * 1024 * 1024;

/** A extensão da foto pelo tipo, ou null quando o tipo não vale (o storage.rules só aceita estes). */
export function extensaoDaFoto(tipo: string): string | null {
  return EXTENSAO[tipo] ?? null;
}

/** O nome da foto no Storage: ft_ com 16 hex, como o storage.rules pede. */
export function nomeDaFoto(tipo: string, aleatorio: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(8))): string | null {
  const extensao = extensaoDaFoto(tipo);
  if (!extensao) return null;
  const hex = Array.from(aleatorio(), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `ft_${hex}.${extensao}`;
}

/** O nome da assinatura no Storage (a foto da via assinada): as_ com 16 hex (parte 3.9a). */
export function nomeDaAssinaturaDoArquivo(tipo: string, aleatorio?: () => Uint8Array): string | null {
  return nomeDaFoto(tipo, aleatorio)?.replace(/^ft_/, "as_") ?? null;
}

/** Quando a foto foi tirada: a data do arquivo, se é do dia da OS em diante e não está no futuro; senão, agora. */
export function instanteDaFoto(ultimaModificacao: number, diaDaOs: string | null, agora: Date): string {
  const quando = new Date(ultimaModificacao);
  if (Number.isNaN(quando.getTime()) || quando.getTime() > agora.getTime()) return agora.toISOString();
  if (diaDaOs && hojeIso(quando) < diaDaOs) return agora.toISOString();
  return quando.toISOString();
}

export function problemaDaFoto(arquivo: { type: string; size: number }): string | null {
  if (!extensaoDaFoto(arquivo.type)) return "Use foto JPG, PNG ou WebP.";
  if (arquivo.size >= MAX_FOTO_BYTES) return "A foto passa de 8 MB.";
  return null;
}
