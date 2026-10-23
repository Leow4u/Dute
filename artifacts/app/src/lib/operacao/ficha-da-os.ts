import { PAPEIS_DE_CAMPO, PAPEL_ROTULO, formatarData, formatarPlaca, type PapelDeCampo, type Vinculo } from "./cadastro";
import { STATUS_DA_OS, type StatusDaOs } from "./fila";
import { SERVICO_ROTULO, milesimos } from "./hoje";

/**
 * A ficha da OS (docs/plataforma/fase-3-operacao.md, parte 3.7d;
 * docs/mockups/OpOS.dc.html): a leitura completa do documento da OS e o que
 * a tela mostra dele (os quatro passos, os locais, as etapas, os itens com o
 * feito, as fotos, a equipe, os veículos e o histórico). Sem valor.
 */

/** A ordem das etapas, igual a functions/operacao/src/domain/execucao.ts (o teste trava). */
export const ETAPAS_DA_OS = ["saida_patio", "chegada_origem", "carregamento", "saida_origem", "chegada_destino", "montagem", "fim"] as const;
export type EtapaDaOs = (typeof ETAPAS_DA_OS)[number];

export const ETAPA_ROTULO: Record<EtapaDaOs, string> = {
  saida_patio: "Saída do pátio",
  chegada_origem: "Chegada na origem",
  carregamento: "Carregamento",
  saida_origem: "Saída da origem",
  chegada_destino: "Chegada no destino",
  montagem: "Montagem",
  fim: "Fim",
};

export type CanalDoRegistro = "escritorio" | "celular";
export type MeioDoEscritorio = "telefone" | "whatsapp" | "presencial";
export const MEIO_ROTULO: Record<MeioDoEscritorio, string> = { telefone: "Telefone", whatsapp: "WhatsApp", presencial: "Presencial" };

export type RegistroLido = { instante: string; canal: CanalDoRegistro; meio: MeioDoEscritorio | null; informadoPor: string | null };
export type EtapaLida = RegistroLido & { etapa: EtapaDaOs };
export type InclusaoLida = RegistroLido & { quantidade: string; pedidoPor: string; motivo: string };
export type OcorrenciaLida = RegistroLido & { id: string; descricao: string };
export type FotoLida = RegistroLido & { id: string; caminho: string; etapa: EtapaDaOs | null; ocorrencia: string | null; linha: string | null; legenda: string | null };

export type ItemLido = {
  id: string;
  codigo: string | null;
  item: string;
  unidade: string | null;
  servico: string | null;
  planejado: string;
  executado: string | null;
  executadoEm: string | null;
  incluidos: InclusaoLida[];
  incluidoEmCampo: boolean;
};

export type PessoaLida = {
  id: string;
  nome: string;
  papel: PapelDeCampo | null;
  vinculo: Vinculo;
  empresa: string | null;
  noApp: boolean;
  /** O login ligado (parte 3.8a): o celular sabe qual pessoa da equipe é quem está nele. */
  uid: string | null;
};
export type VeiculoLido = { id: string; placa: string; tipo: string; modelo: string | null; dono: "proprio" | "terceiro"; empresa: string | null };
export type LocalLido = { nome: string | null; endereco: string | null; complemento: string | null; contato: { nome: string; telefone: string | null } | null };

/** A entrada e a saída de alguém da equipe (parte 3.8a), pelo instante. */
export type PresencaLida = { colaboradorId: string; entrada: string | null; saida: string | null };

export type FichaDaOs = {
  numero: string;
  demanda: string;
  customerCode: string;
  /** O nome do cliente copiado da demanda (parte 3.8a); a OS de antes não tem. */
  clienteNome: string | null;
  status: StatusDaOs;
  edicao: number;
  servicos: string[];
  janela: { data: string; inicio: string | null; fim: string | null } | null;
  locais: { origem: LocalLido | null; destino: LocalLido | null };
  equipe: PessoaLida[];
  veiculos: VeiculoLido[];
  instrucoes: string | null;
  itens: ItemLido[];
  etapas: EtapaLida[];
  ocorrencias: OcorrenciaLida[];
  fotos: FotoLida[];
  presencas: PresencaLida[];
  cancelamento: string | null;
};

// --- Leitura ------------------------------------------------------------------------------

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function textoOuNull(valor: unknown): string | null {
  return texto(valor) || null;
}

function objetos(valor: unknown): Record<string, unknown>[] {
  return Array.isArray(valor) ? valor.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function etapaOuNull(valor: unknown): EtapaDaOs | null {
  return (ETAPAS_DA_OS as readonly string[]).includes(texto(valor)) ? (texto(valor) as EtapaDaOs) : null;
}

function registro(bruto: Record<string, unknown>): RegistroLido | null {
  const instante = texto(bruto.instante);
  if (!instante || Number.isNaN(new Date(instante).getTime())) return null;
  const meio = texto(bruto.meio);
  return {
    instante,
    canal: bruto.canal === "celular" ? "celular" : "escritorio",
    meio: meio === "telefone" || meio === "whatsapp" || meio === "presencial" ? meio : null,
    informadoPor: textoOuNull(bruto.informado_por),
  };
}

function localLido(valor: unknown): LocalLido | null {
  if (!valor || typeof valor !== "object") return null;
  const local = valor as Record<string, unknown>;
  const contato = local.contato && typeof local.contato === "object" ? (local.contato as Record<string, unknown>) : null;
  return {
    nome: textoOuNull(local.nome),
    endereco: textoOuNull(local.endereco),
    complemento: textoOuNull(local.complemento),
    contato: contato && texto(contato.nome) ? { nome: texto(contato.nome), telefone: textoOuNull(contato.telefone) } : null,
  };
}

/** A OS gravada como a ficha usa; null quando não é uma OS legível. */
export function fichaDaLeitura(id: string, data: Record<string, unknown>): FichaDaOs | null {
  if (!(STATUS_DA_OS as readonly string[]).includes(texto(data.status))) return null;
  if (typeof data.edicao !== "number" || !texto(data.demanda) || !texto(data.customer_code)) return null;
  const janela = data.janela && typeof data.janela === "object" ? (data.janela as Record<string, unknown>) : null;
  const locais = data.locais && typeof data.locais === "object" ? (data.locais as Record<string, unknown>) : {};
  const cancelamento = data.cancelamento && typeof data.cancelamento === "object" ? texto((data.cancelamento as Record<string, unknown>).motivo) : "";
  return {
    numero: id,
    demanda: texto(data.demanda),
    customerCode: texto(data.customer_code),
    clienteNome: textoOuNull(data.cliente_nome),
    status: texto(data.status) as StatusDaOs,
    edicao: data.edicao,
    servicos: Array.isArray(data.servicos) ? data.servicos.filter((servico): servico is string => typeof servico === "string") : [],
    janela: janela && texto(janela.data) ? { data: texto(janela.data), inicio: textoOuNull(janela.inicio), fim: textoOuNull(janela.fim) } : null,
    locais: { origem: localLido(locais.origem), destino: localLido(locais.destino) },
    equipe: objetos(data.equipe).flatMap((pessoa): PessoaLida[] => {
      const idDaPessoa = texto(pessoa.colaborador_id);
      if (!idDaPessoa) return [];
      const papel = (PAPEIS_DE_CAMPO as readonly string[]).includes(texto(pessoa.papel)) ? (texto(pessoa.papel) as PapelDeCampo) : null;
      const vinculo: Vinculo = pessoa.vinculo === "freelancer" || pessoa.vinculo === "terceiro" ? pessoa.vinculo : "proprio";
      return [
        { id: idDaPessoa, nome: texto(pessoa.nome) || idDaPessoa, papel, vinculo, empresa: textoOuNull(pessoa.empresa), noApp: pessoa.no_app === true, uid: textoOuNull(pessoa.usuario_uid) },
      ];
    }),
    veiculos: objetos(data.veiculos).flatMap((veiculo): VeiculoLido[] => {
      const idDoVeiculo = texto(veiculo.veiculo_id);
      if (!idDoVeiculo) return [];
      return [
        {
          id: idDoVeiculo,
          placa: texto(veiculo.placa) ? formatarPlaca(texto(veiculo.placa)) : idDoVeiculo,
          tipo: texto(veiculo.tipo),
          modelo: textoOuNull(veiculo.modelo),
          dono: veiculo.dono === "terceiro" ? "terceiro" : "proprio",
          empresa: textoOuNull(veiculo.empresa),
        },
      ];
    }),
    instrucoes: textoOuNull(data.instrucoes),
    itens: objetos(data.itens).flatMap((item): ItemLido[] => {
      const idDaLinha = texto(item.id);
      const planejado = texto(item.planejado) || texto(item.quantidade);
      if (!idDaLinha || !planejado) return [];
      return [
        {
          id: idDaLinha,
          codigo: textoOuNull(item.codigo),
          item: texto(item.item) || texto(item.descricao),
          unidade: textoOuNull(item.unidade),
          servico: textoOuNull(item.servico),
          planejado,
          executado: textoOuNull(item.executado),
          executadoEm: textoOuNull(item.executado_em),
          incluidos: objetos(item.incluidos).flatMap((inclusao): InclusaoLida[] => {
            const base = registro(inclusao);
            return base && texto(inclusao.quantidade)
              ? [{ ...base, quantidade: texto(inclusao.quantidade), pedidoPor: texto(inclusao.pedido_por), motivo: texto(inclusao.motivo) }]
              : [];
          }),
          incluidoEmCampo: item.incluido_em_campo === true,
        },
      ];
    }),
    etapas: objetos(data.etapas).flatMap((bruto): EtapaLida[] => {
      const base = registro(bruto);
      const etapa = etapaOuNull(bruto.etapa);
      return base && etapa ? [{ ...base, etapa }] : [];
    }),
    ocorrencias: objetos(data.ocorrencias).flatMap((bruto): OcorrenciaLida[] => {
      const base = registro(bruto);
      return base && texto(bruto.id) ? [{ ...base, id: texto(bruto.id), descricao: texto(bruto.descricao) }] : [];
    }),
    fotos: objetos(data.fotos).flatMap((bruto): FotoLida[] => {
      const base = registro(bruto);
      if (!base || !texto(bruto.id) || !texto(bruto.caminho)) return [];
      return [
        {
          ...base,
          id: texto(bruto.id),
          caminho: texto(bruto.caminho),
          etapa: etapaOuNull(bruto.etapa),
          ocorrencia: textoOuNull(bruto.ocorrencia),
          linha: textoOuNull(bruto.linha),
          legenda: textoOuNull(bruto.legenda),
        },
      ];
    }),
    presencas: objetos(data.presencas).flatMap((bruto): PresencaLida[] => {
      const colaborador = texto(bruto.colaborador_id);
      if (!colaborador) return [];
      const instanteDe = (marca: unknown) => (marca && typeof marca === "object" ? registro(marca as Record<string, unknown>)?.instante ?? null : null);
      return [{ colaboradorId: colaborador, entrada: instanteDe(bruto.entrada), saida: instanteDe(bruto.saida) }];
    }),
    cancelamento: cancelamento || null,
  };
}

// --- O que a tela mostra ------------------------------------------------------------------

/** "07:05", no fuso de São Paulo. */
export function horaDe(instante: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instante));
}

function dataDe(instante: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instante));
}

function deMilesimos(valor: number): string {
  const inteiro = Math.trunc(valor / 1000);
  const resto = valor % 1000;
  return resto ? `${inteiro}.${String(resto).padStart(3, "0").replace(/0+$/, "")}` : String(inteiro);
}

/** A janela em texto: "hoje 07:30–18:00", "Qui 22/10 07:30", "22/10/2026". */
export function janelaEmTexto(janela: FichaDaOs["janela"], hoje: string): string | null {
  if (!janela) return null;
  const horas = janela.inicio ? (janela.fim ? `${janela.inicio}–${janela.fim}` : janela.inicio) : null;
  const dia = janela.data === hoje ? "hoje" : formatarData(janela.data);
  return [dia, horas].filter(Boolean).join(" ");
}

/** "Transporte e montagem". */
export function servicosEmTexto(servicos: readonly string[]): string | null {
  const rotulos = servicos.map((servico) => SERVICO_ROTULO[servico] ?? servico);
  if (!rotulos.length) return null;
  const [primeiro, ...resto] = rotulos;
  const frase = [primeiro, ...resto.map((rotulo) => rotulo.toLocaleLowerCase("pt-BR"))];
  return frase.length === 1 ? frase[0] : `${frase.slice(0, -1).join(", ")} e ${frase.at(-1)}`;
}

function nomeDe(ficha: Pick<FichaDaOs, "equipe">, id: string | null): string | null {
  if (!id) return null;
  return ficha.equipe.find((pessoa) => pessoa.id === id)?.nome ?? null;
}

/** Quem registrou e por onde: "João Pereira · celular" ou "escritório · informado por João Pereira". */
export function origemEmTexto(ficha: Pick<FichaDaOs, "equipe">, registroLido: RegistroLido): string {
  const quem = nomeDe(ficha, registroLido.informadoPor);
  if (registroLido.canal === "celular") return [quem, "celular"].filter(Boolean).join(" · ");
  return ["escritório", quem ? `informado por ${quem}` : null, registroLido.meio ? MEIO_ROTULO[registroLido.meio].toLocaleLowerCase("pt-BR") : null].filter(Boolean).join(" · ");
}

export type EstadoDoPasso = "feito" | "atual" | "pendente";
export type PassoDaOs = { numero: number; titulo: string; quem: string; detalhe: string | null; estado: EstadoDoPasso };

function placasEmTexto(veiculos: readonly VeiculoLido[]): string | null {
  const placas = veiculos.map((veiculo) => veiculo.placa);
  if (!placas.length) return null;
  return placas.length === 1 ? placas[0] : `${placas.slice(0, -1).join(", ")} e ${placas.at(-1)}`;
}

/** Os quatro passos da OS: agendar, executar, concluir e revisar. */
export function passosDaOs(ficha: FichaDaOs): PassoDaOs[] {
  const ordem: StatusDaOs[] = ["aberta", "agendada", "em_execucao", "em_revisao", "revisada"];
  const posicao = ficha.status === "cancelada" ? -1 : ordem.indexOf(ficha.status);
  const estado = (passo: number): EstadoDoPasso => {
    // aberta = agendar é o atual; agendada = executar; em_execucao = executar; em_revisao = revisar; revisada = todos feitos.
    const atual = posicao <= 0 ? 1 : posicao === 1 || posicao === 2 ? 2 : posicao === 3 ? 4 : 5;
    if (posicao < 0) return "pendente";
    if (passo < atual) return "feito";
    return passo === atual ? "atual" : "pendente";
  };
  const lider = ficha.equipe.find((pessoa) => pessoa.papel === "lider");
  const pessoas = ficha.equipe.length;
  const ultima = ficha.etapas.at(-1);
  const executando = ultima
    ? ultima.etapa === "fim"
      ? `${ETAPA_ROTULO.fim} às ${horaDe(ultima.instante)}`
      : `${ETAPA_ROTULO[ultima.etapa]} desde ${horaDe(ultima.instante)}`
    : null;
  return [
    {
      numero: 1,
      titulo: "Agendar",
      quem: "Coordenação",
      detalhe: [pessoas ? `${pessoas} ${pessoas === 1 ? "pessoa" : "pessoas"}` : "Sem equipe", placasEmTexto(ficha.veiculos)].filter(Boolean).join(" · "),
      estado: estado(1),
    },
    { numero: 2, titulo: "Executar", quem: lider ? `Líder · ${lider.nome}` : "Equipe", detalhe: executando, estado: estado(2) },
    {
      numero: 3,
      titulo: "Concluir",
      quem: "Líder e cliente",
      detalhe: ["Fotos e assinatura no local", ficha.janela?.fim ? `até ${ficha.janela.fim}` : null].filter(Boolean).join(" · "),
      estado: estado(3),
    },
    { numero: 4, titulo: "Revisar", quem: "Coordenação", detalhe: "Itens, fotos e divergências", estado: estado(4) },
  ];
}

export type EtapaNaFicha = { etapa: EtapaDaOs; rotulo: string; hora: string; quem: string | null; estado: "feita" | "atual" | "pendente" | "pulada" };

/** As sete etapas: a hora e quem registrou; a última em curso é "desde"; o fim pendente mostra a janela. */
export function etapasDaFicha(ficha: FichaDaOs): EtapaNaFicha[] {
  const registradas = new Map(ficha.etapas.map((etapa) => [etapa.etapa, etapa]));
  const ultima = ficha.etapas.at(-1);
  const indiceDaUltima = ultima ? ETAPAS_DA_OS.indexOf(ultima.etapa) : -1;
  return ETAPAS_DA_OS.map((etapa, indice) => {
    const feita = registradas.get(etapa);
    if (feita) {
      const atual = feita === ultima && etapa !== "fim" && ficha.status === "em_execucao";
      return { etapa, rotulo: ETAPA_ROTULO[etapa], hora: atual ? `desde ${horaDe(feita.instante)}` : horaDe(feita.instante), quem: origemEmTexto(ficha, feita), estado: atual ? "atual" : "feita" };
    }
    if (indice < indiceDaUltima) return { etapa, rotulo: ETAPA_ROTULO[etapa], hora: "—", quem: null, estado: "pulada" };
    const hora = etapa === "fim" && ficha.janela?.fim ? `até ${ficha.janela.fim}` : "—";
    return { etapa, rotulo: ETAPA_ROTULO[etapa], hora, quem: null, estado: "pendente" };
  });
}

/** A hora em que a etapa aconteceu, para os locais: "saída 10:20", "chegada 11:05". */
export function horaDaEtapa(ficha: FichaDaOs, etapa: EtapaDaOs): string | null {
  const registrada = ficha.etapas.find((item) => item.etapa === etapa);
  return registrada ? horaDe(registrada.instante) : null;
}

export type InclusaoNaFicha = { texto: string };

export type ItemNaFicha = {
  id: string;
  codigo: string | null;
  item: string;
  unidade: string;
  /** O planejado mais o incluído: "160". */
  previsto: string;
  /** "150 + 10" quando houve inclusão em campo. */
  composicao: string | null;
  feito: string;
  /** De 0 a 1, para a barra. */
  fracao: number;
  /** "+10 além do planejado". */
  alem: string | null;
  incluidos: InclusaoNaFicha[];
};

function fotosDaLinha(ficha: FichaDaOs, linha: string): number {
  return ficha.fotos.filter((foto) => foto.linha === linha).length;
}

/** Os itens com o feito e o que foi incluído em campo. */
export function itensDaFicha(ficha: FichaDaOs): ItemNaFicha[] {
  return ficha.itens.map((item) => {
    const planejado = milesimos(item.planejado);
    const incluido = item.incluidos.reduce((soma, inclusao) => soma + milesimos(inclusao.quantidade), 0);
    const previsto = planejado + incluido;
    const feito = item.executado ? milesimos(item.executado) : 0;
    const fotos = fotosDaLinha(ficha, item.id);
    return {
      id: item.id,
      codigo: item.codigo,
      item: item.item,
      unidade: (item.unidade ?? "").toLocaleLowerCase("pt-BR"),
      previsto: deMilesimos(previsto),
      composicao: incluido ? `${deMilesimos(planejado)} + ${deMilesimos(incluido)}` : null,
      feito: deMilesimos(feito),
      fracao: previsto ? Math.min(1, feito / previsto) : 0,
      alem: incluido ? `+${deMilesimos(incluido)} além do planejado` : null,
      incluidos: item.incluidos.map((inclusao, indice) => ({
        texto: [
          `+${inclusao.quantidade} em campo`,
          nomeDe(ficha, inclusao.informadoPor) ?? (inclusao.canal === "celular" ? "celular" : "escritório"),
          horaDe(inclusao.instante),
          inclusao.pedidoPor ? `pedido por ${inclusao.pedidoPor}` : null,
          inclusao.motivo || null,
          indice === item.incluidos.length - 1 && fotos ? `${fotos} ${fotos === 1 ? "foto" : "fotos"}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    };
  });
}

/** "Feito às 14:20": a última vez que um feito foi informado. */
export function feitoEm(ficha: FichaDaOs): string | null {
  const instantes = ficha.itens.map((item) => item.executadoEm).filter((instante): instante is string => Boolean(instante));
  if (!instantes.length) return null;
  return horaDe(instantes.reduce((maior, atual) => (atual > maior ? atual : maior)));
}

export type EntradaDoHistorico = { chave: string; titulo: string; detalhe: string; instante: string };

/** As etapas, as inclusões e as ocorrências, da mais nova para a mais antiga. */
export function historicoDaOs(ficha: FichaDaOs, hoje: string): EntradaDoHistorico[] {
  const quando = (instante: string) => (dataDe(instante) === hoje ? horaDe(instante) : `${formatarData(dataDe(instante)).slice(0, 5)} ${horaDe(instante)}`);
  const entradas: EntradaDoHistorico[] = [
    ...ficha.etapas.map((etapa) => ({
      chave: `etapa:${etapa.etapa}`,
      titulo: etapa.etapa === "montagem" ? "Início da montagem" : etapa.etapa === "carregamento" ? "Início do carregamento" : ETAPA_ROTULO[etapa.etapa],
      detalhe: [origemEmTexto(ficha, etapa), quando(etapa.instante)].join(" · "),
      instante: etapa.instante,
    })),
    ...ficha.itens.flatMap((item) =>
      item.incluidos.map((inclusao, indice) => ({
        chave: `inclusao:${item.id}:${indice}`,
        titulo: `+${inclusao.quantidade} ${item.item} além do planejado`,
        detalhe: [origemEmTexto(ficha, inclusao), inclusao.pedidoPor ? `pedido por ${inclusao.pedidoPor}` : null, quando(inclusao.instante)].filter(Boolean).join(" · "),
        instante: inclusao.instante,
      })),
    ),
    ...ficha.ocorrencias.map((ocorrencia) => ({
      chave: `ocorrencia:${ocorrencia.id}`,
      titulo: ocorrencia.descricao,
      detalhe: ["Ocorrência", origemEmTexto(ficha, ocorrencia), quando(ocorrencia.instante)].join(" · "),
      instante: ocorrencia.instante,
    })),
  ];
  return entradas.sort((a, b) => b.instante.localeCompare(a.instante) || a.chave.localeCompare(b.chave));
}

/** O endereço para "Abrir no Maps": o do destino, ou o da origem. */
export function enderecoNoMaps(ficha: FichaDaOs): string | null {
  const local = ficha.locais.destino?.endereco ? ficha.locais.destino : ficha.locais.origem;
  if (!local?.endereco) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(local.endereco)}`;
}

/** "Líder", "Motorista · no app", "Freelancer · Montador", "Terceiro · Motorista · Rota Sul". */
export function detalheDaPessoa(pessoa: PessoaLida): string {
  const papel = pessoa.papel ? PAPEL_ROTULO[pessoa.papel] : null;
  if (pessoa.vinculo === "freelancer") return ["Freelancer", papel].filter(Boolean).join(" · ");
  if (pessoa.vinculo === "terceiro") return ["Terceiro", papel, pessoa.empresa].filter(Boolean).join(" · ");
  return [papel, pessoa.noApp ? "no app" : null].filter(Boolean).join(" · ") || "Equipe própria";
}

/** "VW Delivery · Baú", "Truck · Terceiro · Rota Sul". */
export function detalheDoVeiculo(veiculo: VeiculoLido): string {
  return [veiculo.modelo, veiculo.tipo, veiculo.dono === "terceiro" ? "Terceiro" : null, veiculo.dono === "terceiro" ? veiculo.empresa : null].filter(Boolean).join(" · ");
}
