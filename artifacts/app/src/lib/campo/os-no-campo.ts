import { PAPEL_ROTULO } from "../operacao/cadastro";
import { ETAPAS_DA_OS, ETAPA_ROTULO, horaDe, servicosEmTexto, type EtapaDaOs, type FichaDaOs, type PessoaLida } from "../operacao/ficha-da-os";
import { milesimos } from "../operacao/hoje";
import type { NovoRegistro, RegistroNaFila } from "./fila";

/**
 * O que o app do campo mostra (docs/plataforma/fase-3-operacao.md, parte
 * 3.8b; docs/mockups/Campo2Hoje.dc.html e Campo2Execucao.dc.html) e os
 * registros que cada toque gera. O que ainda está na fila aparece por cima
 * do gravado, marcado como guardado, para a equipe não registrar duas vezes.
 * Sem valor.
 */

const DIA_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;
const DIA_POR_EXTENSO = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;
const MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;
const QUANTIDADE = /^\d{1,9}(\.\d{1,3})?$/;

function emUtc(data: string): Date {
  return new Date(`${data}T12:00:00Z`);
}

function diaCurto(data: string): string {
  return `${DIA_DA_SEMANA[emUtc(data).getUTCDay()]} ${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

function deMilesimos(valor: number): string {
  const inteiro = Math.trunc(valor / 1000);
  const resto = valor % 1000;
  return resto ? `${inteiro}.${String(resto).padStart(3, "0").replace(/0+$/, "")}` : String(inteiro);
}

/** "Terça, 20 de outubro" e "Olá, Carlos". */
export function saudacao(nome: string | null | undefined, hoje: string): { dia: string; ola: string } {
  const dia = `${DIA_POR_EXTENSO[emUtc(hoje).getUTCDay()]}, ${Number(hoje.slice(8, 10))} de ${MES[Number(hoje.slice(5, 7)) - 1]}`;
  const primeiro = (nome ?? "").trim().split(/\s+/)[0];
  return { dia, ola: primeiro ? `Olá, ${primeiro}` : "Olá" };
}

// --- Minhas OS ----------------------------------------------------------------------------

export type CartaoDoCampo = {
  numero: string;
  cliente: string;
  servicos: string | null;
  demanda: string;
  /** "Carregamento desde 07:50", "Hoje 07:30", "qui 22/10". */
  quando: string;
  hora: string | null;
  local: string | null;
  destino: string | null;
  equipe: number;
  placas: string[];
  status: FichaDaOs["status"];
  /** Serviço ou vistoria (parte 3.11b). */
  tipo: FichaDaOs["tipo"];
};

export type MinhasOs = { agora: CartaoDoCampo[]; depois: CartaoDoCampo[]; feito: CartaoDoCampo[] };

function enderecoCurto(local: FichaDaOs["locais"]["origem"]): string | null {
  if (!local) return null;
  return [local.endereco ?? local.nome, local.complemento].filter(Boolean).join(" · ") || null;
}

function cartao(ficha: FichaDaOs, hoje: string): CartaoDoCampo {
  const ultima = ficha.etapas.at(-1);
  const data = ficha.janela?.data ?? null;
  const quando = ultima
    ? `${ETAPA_ROTULO[ultima.etapa]} ${ultima.etapa === "fim" ? "às" : "desde"} ${horaDe(ultima.instante)}`
    : data === hoje
      ? ["Hoje", ficha.janela?.inicio].filter(Boolean).join(" ")
      : data
        ? diaCurto(data)
        : "Sem data";
  return {
    numero: ficha.numero,
    cliente: ficha.clienteNome ?? ficha.customerCode,
    servicos: servicosEmTexto(ficha.servicos),
    demanda: ficha.demanda,
    quando,
    hora: ficha.janela?.inicio ?? null,
    local: enderecoCurto(ficha.locais.origem) ?? enderecoCurto(ficha.locais.destino),
    destino: ficha.locais.origem && ficha.locais.destino ? enderecoCurto(ficha.locais.destino) : null,
    equipe: ficha.equipe.length,
    placas: ficha.veiculos.map((veiculo) => (veiculo.dono === "terceiro" && veiculo.empresa ? `${veiculo.placa} · ${veiculo.empresa}` : veiculo.placa)),
    status: ficha.status,
    tipo: ficha.tipo,
  };
}

function pelaJanela(a: FichaDaOs, b: FichaDaOs): number {
  return `${a.janela?.data ?? "9"}${a.janela?.inicio ?? "99"}${a.numero}`.localeCompare(`${b.janela?.data ?? "9"}${b.janela?.inicio ?? "99"}${b.numero}`);
}

/**
 * Agora: a OS em execução e a agendada até hoje. Depois: a agendada dos
 * próximos dias. Feito: a concluída nos últimos 7 dias. A cancelada some.
 */
export function minhasOs(fichas: readonly FichaDaOs[], hoje: string): MinhasOs {
  const seteDiasAtras = new Date(emUtc(hoje).getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const ordenadas = [...fichas].sort(pelaJanela);
  return {
    agora: ordenadas.filter((ficha) => ficha.status === "em_execucao" || (ficha.status === "agendada" && (ficha.janela?.data ?? hoje) <= hoje)).map((ficha) => cartao(ficha, hoje)),
    depois: ordenadas.filter((ficha) => ficha.status === "agendada" && (ficha.janela?.data ?? hoje) > hoje).map((ficha) => cartao(ficha, hoje)),
    feito: ordenadas
      .filter((ficha) => (ficha.status === "em_revisao" || ficha.status === "revisada") && (ficha.janela?.data ?? "") >= seteDiasAtras)
      .reverse()
      .map((ficha) => cartao(ficha, hoje)),
  };
}

// --- A OS no celular ----------------------------------------------------------------------

function pendentesDa(ficha: Pick<FichaDaOs, "numero">, pendentes: readonly RegistroNaFila[]): RegistroNaFila[] {
  return pendentes.filter((registro) => registro.dados.numero === ficha.numero);
}

function textoDe(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

export type EtapaNoCampo = { etapa: EtapaDaOs; rotulo: string; hora: string | null; estado: "feita" | "guardada" | "pulada" | "pendente" };

export type EtapasNoCampo = { etapas: EtapaNoCampo[]; proxima: EtapaDaOs | null; outras: EtapaDaOs[]; desde: string | null };

/** As sete etapas com o gravado e o guardado; a próxima é a que vem depois da última. */
export function etapasNoCampo(ficha: FichaDaOs, pendentes: readonly RegistroNaFila[]): EtapasNoCampo {
  const guardadas = new Map(
    pendentesDa(ficha, pendentes)
      .filter((registro) => registro.callable === "registerStep")
      .map((registro) => [textoDe(registro.dados.etapa) as EtapaDaOs, textoDe(registro.dados.instante)]),
  );
  const gravadas = new Map(ficha.etapas.map((etapa) => [etapa.etapa, etapa.instante]));
  const ultimaIndice = Math.max(-1, ...ETAPAS_DA_OS.map((etapa, indice) => (gravadas.has(etapa) || guardadas.has(etapa) ? indice : -1)));
  const etapas = ETAPAS_DA_OS.map((etapa, indice): EtapaNoCampo => {
    const gravada = gravadas.get(etapa);
    if (gravada) return { etapa, rotulo: ETAPA_ROTULO[etapa], hora: horaDe(gravada), estado: "feita" };
    const guardada = guardadas.get(etapa);
    if (guardada) return { etapa, rotulo: ETAPA_ROTULO[etapa], hora: horaDe(guardada), estado: "guardada" };
    return { etapa, rotulo: ETAPA_ROTULO[etapa], hora: null, estado: indice < ultimaIndice ? "pulada" : "pendente" };
  });
  const restantes = ETAPAS_DA_OS.slice(ultimaIndice + 1);
  const primeira = ficha.etapas[0]?.instante ?? [...guardadas.values()].sort()[0] ?? null;
  return { etapas, proxima: restantes[0] ?? null, outras: restantes.slice(1), desde: primeira };
}

/** "2h 23min" desde a primeira etapa. */
export function duracaoDesde(instante: string | null, agora: Date): string | null {
  if (!instante) return null;
  const minutos = Math.max(0, Math.floor((agora.getTime() - Date.parse(instante)) / 60_000));
  const horas = Math.floor(minutos / 60);
  return horas ? `${horas}h ${String(minutos % 60).padStart(2, "0")}min` : `${minutos}min`;
}

export type ItemNoCampo = {
  id: string;
  codigo: string | null;
  servico: string | null;
  item: string;
  unidade: string;
  /** O feito em milésimos, com o guardado por cima. */
  feito: number;
  previsto: number;
  guardado: boolean;
};

/** Os itens com o feito gravado ou, se há, o último guardado; a inclusão guardada soma ao previsto. */
export function itensNoCampo(ficha: FichaDaOs, pendentes: readonly RegistroNaFila[]): ItemNoCampo[] {
  const meus = pendentesDa(ficha, pendentes).filter((registro) => registro.callable === "registerItem");
  return ficha.itens.map((item) => {
    const incluidoGravado = item.incluidos.reduce((soma, inclusao) => soma + milesimos(inclusao.quantidade), 0);
    const inclusoesGuardadas = meus.filter((registro) => registro.dados.action === "added" && registro.dados.linha === item.id);
    const incluidoGuardado = inclusoesGuardadas.reduce((soma, registro) => soma + milesimos(textoDe(registro.dados.quantidade)), 0);
    const feitoGuardado = [...meus].reverse().find((registro) => registro.dados.action === "executed" && registro.dados.linha === item.id);
    const feitoGravado = item.executado ? milesimos(item.executado) : 0;
    return {
      id: item.id,
      codigo: item.codigo,
      servico: item.servico,
      item: item.item,
      unidade: (item.unidade ?? "").toLocaleLowerCase("pt-BR"),
      feito: feitoGuardado ? milesimos(textoDe(feitoGuardado.dados.executado)) : feitoGravado + incluidoGuardado,
      previsto: milesimos(item.planejado) + incluidoGravado + incluidoGuardado,
      guardado: Boolean(feitoGuardado) || inclusoesGuardadas.length > 0,
    };
  });
}

/** O feito depois de um toque em + ou −: inteiro, entre zero e o previsto. */
export function feitoDepoisDoToque(item: Pick<ItemNoCampo, "feito" | "previsto">, delta: 1 | -1): number {
  return Math.min(item.previsto, Math.max(0, Math.round(item.feito / 1000) * 1000 + delta * 1000));
}

export function quantidadeEmTexto(milesimosDoItem: number): string {
  return deMilesimos(milesimosDoItem);
}

export type PessoaNoCampo = {
  id: string;
  nome: string;
  detalhe: string;
  entrada: string | null;
  saida: string | null;
  /** Quem está no celular pode marcar a presença dela: o líder marca todos, os outros só a própria. */
  podeMarcar: boolean;
  souEu: boolean;
};

function detalheNoCampo(pessoa: PessoaLida): string {
  const papel = pessoa.papel ? PAPEL_ROTULO[pessoa.papel] : null;
  if (pessoa.vinculo === "terceiro") return ["Terceiro", papel, pessoa.empresa].filter(Boolean).join(" · ");
  if (pessoa.vinculo === "freelancer") return ["Freelancer", papel].filter(Boolean).join(" · ");
  return papel ?? "Equipe";
}

/** Quem é quem no celular: a pessoa da equipe com o login de quem está nele. */
export function euNaEquipe(ficha: Pick<FichaDaOs, "equipe">, uid: string | null | undefined): PessoaLida | null {
  if (!uid) return null;
  return ficha.equipe.find((pessoa) => pessoa.uid === uid) ?? null;
}

/** A equipe com a presença gravada ou guardada e quem pode marcar a de cada um. */
export function equipeNoCampo(ficha: FichaDaOs, pendentes: readonly RegistroNaFila[], uid: string | null | undefined): PessoaNoCampo[] {
  const eu = euNaEquipe(ficha, uid);
  const lider = eu?.papel === "lider";
  const guardadas = pendentesDa(ficha, pendentes).filter((registro) => registro.callable === "registerPresence");
  return ficha.equipe.map((pessoa) => {
    const gravada = ficha.presencas.find((presenca) => presenca.colaboradorId === pessoa.id);
    const guardada = (tipo: "entrada" | "saida") =>
      guardadas.find((registro) => registro.dados.colaborador_id === pessoa.id && registro.dados.tipo === tipo)?.dados.instante;
    const entrada = gravada?.entrada ?? (textoDe(guardada("entrada")) || null);
    const saida = gravada?.saida ?? (textoDe(guardada("saida")) || null);
    return {
      id: pessoa.id,
      nome: pessoa.nome,
      detalhe: detalheNoCampo(pessoa),
      entrada: entrada ? horaDe(entrada) : null,
      saida: saida ? horaDe(saida) : null,
      podeMarcar: lider || eu?.id === pessoa.id,
      souEu: eu?.id === pessoa.id,
    };
  });
}

// --- Os registros de cada toque -----------------------------------------------------------

/** "Registrar saída da origem". */
export function acaoDaEtapa(etapa: EtapaDaOs): string {
  const rotulo = ETAPA_ROTULO[etapa];
  return `Registrar ${rotulo.charAt(0).toLocaleLowerCase("pt-BR")}${rotulo.slice(1)}`;
}

export function registroDeEtapa(ficha: Pick<FichaDaOs, "numero">, etapa: EtapaDaOs, agora: Date): NovoRegistro {
  return { callable: "registerStep", dados: { numero: ficha.numero, etapa, instante: agora.toISOString() }, rotulo: ETAPA_ROTULO[etapa] };
}

/** O feito é absoluto: o mesmo grupo por linha faz só o último toque ir. */
export function registroDeFeito(ficha: Pick<FichaDaOs, "numero">, item: Pick<ItemNoCampo, "id" | "item">, feito: number, agora: Date): NovoRegistro {
  return {
    callable: "registerItem",
    dados: { action: "executed", numero: ficha.numero, linha: item.id, executado: deMilesimos(feito), instante: agora.toISOString() },
    grupo: `feito:${ficha.numero}:${item.id}`,
    rotulo: item.item,
  };
}

export type InclusaoNoCampo =
  | { tipo: "linha"; linha: string; nome: string }
  | { tipo: "catalogo"; lpuItemId: string; nome: string }
  | { tipo: "avulso"; nome: string; unidade: string };

export function problemasDaInclusao(inclusao: InclusaoNoCampo | null, quantidade: string, pedidoPor: string, motivo: string): string[] {
  const problemas: string[] = [];
  if (!inclusao) problemas.push("Escolha o item.");
  else if (inclusao.tipo === "avulso" && (inclusao.nome.trim().length < 2 || !inclusao.unidade.trim())) problemas.push("Item avulso: informe o nome e a unidade.");
  const digitada = quantidade.trim().replace(",", ".");
  if (!QUANTIDADE.test(digitada) || milesimos(digitada) <= 0) problemas.push("Informe a quantidade.");
  if (pedidoPor.trim().length < 2) problemas.push("Informe quem pediu no local.");
  if (motivo.trim().length < 3) problemas.push("Informe o motivo.");
  return problemas;
}

export function registroDeInclusao(
  ficha: Pick<FichaDaOs, "numero">,
  inclusao: InclusaoNoCampo,
  quantidade: string,
  pedidoPor: string,
  motivo: string,
  agora: Date,
): NovoRegistro {
  const alvo =
    inclusao.tipo === "linha"
      ? { linha: inclusao.linha }
      : inclusao.tipo === "catalogo"
        ? { lpu_item_id: inclusao.lpuItemId }
        : { item: inclusao.nome.trim(), unidade: inclusao.unidade.trim().toUpperCase() };
  return {
    callable: "registerItem",
    dados: {
      action: "added",
      numero: ficha.numero,
      ...alvo,
      quantidade: quantidade.trim().replace(",", "."),
      pedido_por: pedidoPor.trim(),
      motivo: motivo.trim(),
      instante: agora.toISOString(),
    },
    rotulo: `Incluir ${inclusao.nome}`,
  };
}

export function registroDePresenca(ficha: Pick<FichaDaOs, "numero">, pessoa: Pick<PessoaNoCampo, "id" | "nome">, tipo: "entrada" | "saida", agora: Date): NovoRegistro {
  return {
    callable: "registerPresence",
    dados: { numero: ficha.numero, colaborador_id: pessoa.id, tipo, instante: agora.toISOString() },
    rotulo: `${tipo === "entrada" ? "Entrada" : "Saída"} de ${pessoa.nome}`,
  };
}

export function registroDeOcorrencia(ficha: Pick<FichaDaOs, "numero">, descricao: string, agora: Date): NovoRegistro {
  return { callable: "registerOccurrence", dados: { numero: ficha.numero, descricao: descricao.trim(), instante: agora.toISOString() }, rotulo: "Ocorrência" };
}

/** A foto vai junto: sobe ao Storage e attachPhoto a grava (nome e instante saem na hora da foto). */
export function registroDeFoto(
  ficha: Pick<FichaDaOs, "numero">,
  foto: { arquivo: Blob; nome: string; contentType: string; instante: string },
  extra: { legenda?: string | null; etapa?: EtapaDaOs | null; linha?: string | null } = {},
): NovoRegistro {
  return {
    callable: "attachPhoto",
    dados: {
      numero: ficha.numero,
      arquivo: foto.nome,
      instante: foto.instante,
      ...(extra.legenda ? { legenda: extra.legenda.slice(0, 60) } : {}),
      ...(extra.etapa ? { etapa: extra.etapa } : {}),
      ...(extra.linha ? { linha: extra.linha } : {}),
    },
    foto: { caminho: `os/${ficha.numero}/fotos/${foto.nome}`, arquivo: foto.arquivo, contentType: foto.contentType },
    rotulo: "Foto",
  };
}
