import type { CallableDaOperacao } from "./api";
import type { LinhaDoSaldo } from "./demandas";
import { horaDe, type FichaDaOs } from "./ficha-da-os";
import { milesimos } from "./hoje";

/**
 * A revisão interna na tela (docs/plataforma/fase-3-operacao.md, parte
 * 3.10b; docs/mockups/OpRevisao.dc.html): as OS para revisar, e a da vez
 * com as fotos, a assinatura, as horas, os itens com o executado e o saldo da
 * demanda, e cada divergência com as decisões que valem para ela. A tela
 * confere antes; reviewServiceOrder confere de novo (parte 3.10a). Sem valor.
 */

export const DECISOES_A_MAIS = ["cobrar", "aditivo", "absorver"] as const;
export const DECISOES_A_MENOS = ["proxima_os", "encerrar"] as const;
export type Decisao = (typeof DECISOES_A_MAIS)[number] | (typeof DECISOES_A_MENOS)[number];
/** Na tela, "Corrigir quantidade" é mais uma opção; o que resta da divergência se decide em seguida. */
export type EscolhaNaTela = Decisao | "corrigir";

export const DECISAO_ROTULO: Record<EscolhaNaTela, string> = {
  cobrar: "Cobrar na execução",
  aditivo: "Pedir aditivo ao Comercial",
  absorver: "Absorver sem cobrar",
  proxima_os: "Passar para a próxima OS",
  encerrar: "Encerrar sem executar",
  corrigir: "Corrigir quantidade",
};

const QUANTIDADE = /^\d{1,9}(\.\d{1,3})?$/;

function deMilesimos(valor: number): string {
  const absoluto = Math.abs(valor);
  const inteiro = Math.trunc(absoluto / 1000);
  const resto = absoluto % 1000;
  return `${valor < 0 ? "-" : ""}${resto ? `${inteiro}.${String(resto).padStart(3, "0").replace(/0+$/, "")}` : inteiro}`;
}

function comSinal(valor: number): string {
  return `${valor > 0 ? "+" : "−"}${deMilesimos(Math.abs(valor))}`;
}

function quantidadeDigitada(valor: string): string {
  return valor.trim().replace(",", ".");
}

// --- Para revisar -------------------------------------------------------------------------

export type CartaoParaRevisar = { numero: string; cliente: string; demanda: string; servicos: string | null; divergencias: number; aceite: string; desde: string | null };

/** A divergência de cada linha: o executado menos o planejado (o incluído em campo entra no executado). */
function diferencaDa(item: FichaDaOs["itens"][number]): number {
  return (item.executado ? milesimos(item.executado) : 0) - milesimos(item.planejado);
}

export function divergenciasDa(ficha: Pick<FichaDaOs, "itens">): number {
  return ficha.itens.filter((item) => diferencaDa(item) !== 0).length;
}

/** "Assinada 17:52 por Renata Campos"; "Sem aceite no local · 17:52". */
export function aceiteCurto(ficha: Pick<FichaDaOs, "conclusao">): string {
  const conclusao = ficha.conclusao;
  if (!conclusao) return "Sem conclusão";
  return conclusao.aceite === "assinatura" ? `Assinada ${horaDe(conclusao.instante)} por ${conclusao.responsavel.nome}` : `Sem aceite no local · ${horaDe(conclusao.instante)}`;
}

/**
 * A OS da vez: a pedida na URL (?os=); sem ela, a que já está na tela,
 * enquanto espera a revisão; e só então a que espera há mais tempo. A OS que
 * chega à lista depois (a conclusão registrada com a hora de antes, a fila
 * do campo que sincronizou tarde) entra sem tomar o lugar da que está na
 * tela, nem apagar a revisão começada.
 */
export function osDaVezNaRevisao(cartoes: readonly Pick<CartaoParaRevisar, "numero">[], pedida: string | null, naTela: string | null): string | null {
  if (pedida && cartoes.some((cartao) => cartao.numero === pedida)) return pedida;
  if (naTela && cartoes.some((cartao) => cartao.numero === naTela)) return naTela;
  return cartoes[0]?.numero ?? null;
}

/** As OS em revisão, quem espera há mais tempo primeiro. */
export function paraRevisar(fichas: readonly FichaDaOs[], nomes: Readonly<Record<string, string>>, servicosEmTexto: (servicos: readonly string[]) => string | null): CartaoParaRevisar[] {
  return fichas
    .filter((ficha) => ficha.status === "em_revisao")
    .map((ficha) => ({
      numero: ficha.numero,
      cliente: nomes[ficha.customerCode] || ficha.clienteNome || ficha.customerCode,
      demanda: ficha.demanda,
      servicos: servicosEmTexto(ficha.servicos),
      divergencias: divergenciasDa(ficha),
      aceite: aceiteCurto(ficha),
      desde: ficha.conclusao?.instante ?? null,
    }))
    .sort((a, b) => (a.desde ?? "").localeCompare(b.desde ?? "") || a.numero.localeCompare(b.numero));
}

// --- A OS da vez --------------------------------------------------------------------------

function minutosEmTexto(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  return `${horas}h${String(minutos % 60).padStart(2, "0")}`;
}

/** "10h15" e "contra 10h30 planejadas · 8 pessoas". */
export function horasDaOs(ficha: Pick<FichaDaOs, "etapas" | "conclusao" | "janela" | "equipe">): { real: string | null; detalhe: string } {
  const inicio = ficha.etapas[0]?.instante ?? null;
  const fim = ficha.etapas.find((etapa) => etapa.etapa === "fim")?.instante ?? ficha.conclusao?.instante ?? null;
  const real = inicio && fim ? minutosEmTexto(Math.max(0, Math.round((Date.parse(fim) - Date.parse(inicio)) / 60_000))) : null;
  const janela = ficha.janela?.inicio && ficha.janela.fim ? ficha.janela : null;
  const planejados = janela
    ? (() => {
        const [hi, mi] = (janela.inicio as string).split(":").map(Number);
        const [hf, mf] = (janela.fim as string).split(":").map(Number);
        return hf * 60 + mf - (hi * 60 + mi);
      })()
    : null;
  const pessoas = `${ficha.equipe.length} ${ficha.equipe.length === 1 ? "pessoa" : "pessoas"}`;
  return { real, detalhe: [planejados && planejados > 0 ? `contra ${minutosEmTexto(planejados)} planejadas` : null, pessoas].filter(Boolean).join(" · ") };
}

/** "Concluída em campo 17:45 · assinada 17:52 por Renata Campos (Facilities)". */
export function conclusaoEmTexto(ficha: Pick<FichaDaOs, "etapas" | "conclusao">): string | null {
  const conclusao = ficha.conclusao;
  if (!conclusao) return null;
  const fim = ficha.etapas.find((etapa) => etapa.etapa === "fim");
  const emCampo = fim ? `Concluída em campo ${horaDe(fim.instante)}` : null;
  const aceite =
    conclusao.aceite === "assinatura"
      ? `assinada ${horaDe(conclusao.instante)} por ${conclusao.responsavel.nome}${conclusao.responsavel.cargo ? ` (${conclusao.responsavel.cargo})` : ""}`
      : `sem aceite no local · recebido por ${conclusao.responsavel.nome}`;
  return [emCampo, emCampo ? aceite : `${aceite.charAt(0).toUpperCase()}${aceite.slice(1)}`].filter(Boolean).join(" · ");
}

export type LinhaParaRevisar = {
  id: string;
  codigo: string | null;
  item: string;
  unidade: string;
  /** Em milésimos. */
  planejado: number;
  executado: number;
  previsto: number;
  diferenca: number;
  /** O escopo da linha na demanda e o saldo livre (com esta OS pelo planejado), em milésimos; null fora do escopo. */
  orcado: number | null;
  saldoLivre: number | null;
  /** "acima do orçado (310 de 300)", "dentro do saldo (5 livres)". */
  contexto: string | null;
  /** As inclusões em campo e o motivo dito na conclusão. */
  detalhes: string[];
  /** As decisões que valem para o que diverge (antes de corrigir). */
  opcoes: EscolhaNaTela[];
};

function nomeNaEquipe(ficha: Pick<FichaDaOs, "equipe">, id: string | null): string | null {
  return id ? (ficha.equipe.find((pessoa) => pessoa.id === id)?.nome ?? null) : null;
}

/** As decisões que valem para a diferença, pelo sinal e pela demanda (direta ou com escopo fechado). */
export function opcoesPara(diferenca: number, contexto: { direta: boolean; saldoLivre: number | null }): Decisao[] {
  if (diferenca > 0) {
    const cobrar = contexto.direta || (contexto.saldoLivre !== null && diferenca <= contexto.saldoLivre);
    return [...(cobrar ? (["cobrar"] as const) : []), ...(contexto.direta ? [] : (["aditivo"] as const)), "absorver"];
  }
  if (diferenca < 0) return [...(contexto.saldoLivre !== null ? (["proxima_os"] as const) : []), "encerrar"];
  return [];
}

/** Os itens da OS com o executado, a diferença, o orçado e o saldo livre da demanda, e as opções de cada divergência. */
export function linhasParaRevisar(ficha: FichaDaOs, saldo: readonly LinhaDoSaldo[] | null, direta: boolean): LinhaParaRevisar[] {
  const porLinha = new Map((saldo ?? []).map((linha) => [linha.id, linha]));
  return ficha.itens.map((item) => {
    const planejado = milesimos(item.planejado);
    const executado = item.executado ? milesimos(item.executado) : 0;
    const incluido = item.incluidos.reduce((soma, inclusao) => soma + milesimos(inclusao.quantidade), 0);
    const diferenca = executado - planejado;
    const doEscopo = porLinha.get(item.id);
    const orcado = doEscopo ? milesimos(doEscopo.escopo) : null;
    const saldoLivre = doEscopo ? milesimos(doEscopo.saldo.replace(/^-/, "")) * (doEscopo.saldo.startsWith("-") ? -1 : 1) : null;
    const contexto =
      diferenca > 0 && !direta && orcado !== null && saldoLivre !== null
        ? diferenca > saldoLivre
          ? `acima do orçado (${deMilesimos(orcado - saldoLivre + diferenca)} de ${deMilesimos(orcado)})`
          : `dentro do saldo (${deMilesimos(saldoLivre)} ${saldoLivre === 1000 ? "livre" : "livres"})`
        : null;
    const motivo = ficha.conclusao?.diferencas.find((diferencaDaConclusao) => diferencaDaConclusao.linha === item.id)?.motivo;
    const detalhes = [
      ...item.incluidos.map((inclusao) =>
        [
          `+${inclusao.quantidade} incluídas em campo`,
          nomeNaEquipe(ficha, inclusao.informadoPor),
          `às ${horaDe(inclusao.instante)}`,
          inclusao.pedidoPor ? `pedido por ${inclusao.pedidoPor}` : null,
          inclusao.motivo || null,
        ]
          .filter(Boolean)
          .join(" · "),
      ),
      ...(motivo ? [`Na conclusão: ${motivo}`] : []),
    ];
    return {
      id: item.id,
      codigo: item.codigo,
      item: item.item,
      unidade: (item.unidade ?? "").toLocaleLowerCase("pt-BR"),
      planejado,
      executado,
      previsto: planejado + incluido,
      diferenca,
      orcado,
      saldoLivre,
      contexto,
      detalhes,
      opcoes: diferenca === 0 ? [] : [...opcoesPara(diferenca, { direta, saldoLivre }), "corrigir"],
    };
  });
}

/** "+10 Cadeira · −2 Mesa". */
export function divergenciasEmTexto(linhas: readonly LinhaParaRevisar[]): string | null {
  const partes = linhas.filter((linha) => linha.diferenca !== 0).map((linha) => `${comSinal(linha.diferenca)} ${linha.item}`);
  return partes.length ? partes.join(" · ") : null;
}

export { comSinal, deMilesimos as quantidadeEmTexto };

// --- O formulário -------------------------------------------------------------------------

export type DecisaoDaLinha = { escolha: EscolhaNaTela | ""; quantidade: string; motivoDaCorrecao: string; resto: Decisao | ""; motivo: string };
export type FormularioDaRevisao = { linhas: Record<string, DecisaoDaLinha>; nota: string };

export function revisaoInicial(linhas: readonly LinhaParaRevisar[]): FormularioDaRevisao {
  return {
    linhas: Object.fromEntries(
      linhas.filter((linha) => linha.diferenca !== 0).map((linha) => [linha.id, { escolha: "", quantidade: deMilesimos(linha.executado), motivoDaCorrecao: "", resto: "", motivo: "" }]),
    ),
    nota: "",
  };
}

/** A diferença que resta depois da correção (ou null se a quantidade digitada não vale). */
export function diferencaCorrigida(linha: Pick<LinhaParaRevisar, "planejado">, decisao: Pick<DecisaoDaLinha, "quantidade">): number | null {
  const digitada = quantidadeDigitada(decisao.quantidade);
  return QUANTIDADE.test(digitada) ? milesimos(digitada) - linha.planejado : null;
}

/** A decisão que vai para a callable: a escolhida, ou, corrigida a quantidade, a do que resta. */
function decisaoFinal(linha: LinhaParaRevisar, decisao: DecisaoDaLinha): Decisao | null {
  if (decisao.escolha === "corrigir") return decisao.resto || null;
  return decisao.escolha || null;
}

/** O consumido do saldo pela decisão: o executado quando se cobra ou volta ao saldo; o planejado nos outros casos. */
export function saldoDepois(linha: LinhaParaRevisar, decisao: DecisaoDaLinha | undefined): number | null {
  if (linha.saldoLivre === null) return null;
  const executado = decisao?.escolha === "corrigir" ? (diferencaCorrigida(linha, decisao) ?? linha.diferenca) + linha.planejado : linha.executado;
  const final = decisao ? decisaoFinal(linha, decisao) : null;
  const consumido = final === "cobrar" || final === "proxima_os" ? executado : linha.planejado;
  return linha.saldoLivre + linha.planejado - consumido;
}

export function problemasDaRevisao(form: FormularioDaRevisao, linhas: readonly LinhaParaRevisar[], direta: boolean): string[] {
  const problemas: string[] = [];
  for (const linha of linhas) {
    if (linha.diferenca === 0) continue;
    const decisao = form.linhas[linha.id];
    if (!decisao?.escolha || !linha.opcoes.includes(decisao.escolha)) {
      problemas.push(`${linha.item}: decida a divergência (${comSinal(linha.diferenca)}).`);
      continue;
    }
    let diferenca = linha.diferenca;
    if (decisao.escolha === "corrigir") {
      const corrigida = diferencaCorrigida(linha, decisao);
      if (corrigida === null) {
        problemas.push(`${linha.item}: informe a quantidade executada.`);
        continue;
      }
      if (corrigida + linha.planejado === linha.executado) problemas.push(`${linha.item}: a quantidade corrigida é a mesma do campo.`);
      if (corrigida + linha.planejado > linha.previsto) problemas.push(`${linha.item}: a quantidade corrigida passa do previsto (${deMilesimos(linha.previsto)}).`);
      if (decisao.motivoDaCorrecao.trim().length < 3) problemas.push(`${linha.item}: informe o motivo da correção.`);
      diferenca = corrigida;
      if (diferenca !== 0 && !opcoesPara(diferenca, { direta, saldoLivre: linha.saldoLivre }).includes(decisao.resto as Decisao)) {
        problemas.push(`${linha.item}: decida o que resta (${comSinal(diferenca)}).`);
        continue;
      }
    }
    const final = decisaoFinal(linha, decisao);
    if (final === "absorver" && decisao.motivo.trim().length < 3) problemas.push(`${linha.item}: informe por que absorver sem cobrar.`);
  }
  if (form.nota.trim().length > 1000) problemas.push("Use até 1000 caracteres na nota.");
  return problemas;
}

/** Algum item vai para aditivo: o botão diz "Concluir revisão e pedir aditivo". */
export function pedeAditivo(form: FormularioDaRevisao, linhas: readonly LinhaParaRevisar[]): boolean {
  return linhas.some((linha) => {
    const decisao = form.linhas[linha.id];
    return decisao ? decisaoFinal(linha, decisao) === "aditivo" : false;
  });
}

export type PedidoDaRevisao = { callable: CallableDaOperacao; dados: Record<string, unknown> };

/** O pedido no formato de reviewServiceOrder: só as linhas que divergem, com a correção e a decisão. */
export function pedidoDaRevisao(form: FormularioDaRevisao, linhas: readonly LinhaParaRevisar[], numero: string, chave: string): PedidoDaRevisao {
  return {
    callable: "reviewServiceOrder",
    dados: {
      idempotency_key: chave,
      numero,
      linhas: linhas.flatMap((linha) => {
        const decisao = form.linhas[linha.id];
        if (linha.diferenca === 0 || !decisao) return [];
        const corrigida = decisao.escolha === "corrigir" ? diferencaCorrigida(linha, decisao) : null;
        const final = decisaoFinal(linha, decisao);
        const resta = corrigida !== null ? corrigida : linha.diferenca;
        return [
          {
            linha: linha.id,
            ...(corrigida !== null ? { executado: quantidadeDigitada(decisao.quantidade), motivo_da_correcao: decisao.motivoDaCorrecao.trim() } : {}),
            ...(resta !== 0 && final ? { decisao: final } : {}),
            ...(final === "absorver" ? { motivo: decisao.motivo.trim() } : {}),
          },
        ];
      }),
      ...(form.nota.trim() ? { nota: form.nota.trim() } : {}),
    },
  };
}
