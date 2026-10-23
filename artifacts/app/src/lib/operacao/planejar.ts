import { PAPEL_ROTULO, type ColaboradorDaLista, type PapelDeCampo, type VeiculoDaLista } from "./cadastro";
import type { LinhaDoSaldo } from "./demandas";
import type { OsDaFila } from "./fila";
import { milesimos } from "./hoje";

/**
 * Planejar OS (docs/plataforma/fase-3-operacao.md, parte 3.6a;
 * docs/mockups/OpOSPlanejar.dc.html): uma ou várias OS da demanda, cada uma
 * com a fatia do saldo, a janela, a equipe com o papel de cada pessoa e os
 * veículos. A callable (`saveServiceOrder`, action `plan`) confere tudo de
 * novo; aqui a tela diz antes o que impede (passar do saldo) e o que só
 * merece atenção (sem equipe, sem veículo, sem líder, alguém já escalado no
 * dia). Nunca preço.
 */

export type PessoaNoPlano = { colaboradorId: string; papel: PapelDeCampo | "" ; ordens: number[] };
export type VeiculoNoPlano = { veiculoId: string; ordens: number[] };

export type OsNoPlano = {
  data: string;
  inicio: string;
  fim: string;
  /** Quanto de cada linha (pelo id) vai nesta OS, como digitado. */
  itens: Record<string, string>;
};

export type FormularioDoPlano = {
  ordens: OsNoPlano[];
  /** A equipe e os veículos com as OS de que cada um participa (pelo índice). */
  equipe: PessoaNoPlano[];
  veiculos: VeiculoNoPlano[];
  instrucoes: string;
  contatoOrigem: { nome: string; telefone: string };
  contatoDestino: { nome: string; telefone: string };
};

function deMilesimos(valor: number): string {
  const sinal = valor < 0 ? "-" : "";
  const absoluto = Math.abs(valor);
  const inteiro = Math.floor(absoluto / 1000);
  const resto = String(absoluto % 1000).padStart(3, "0").replace(/0+$/, "");
  return `${sinal}${resto ? `${inteiro}.${resto}` : inteiro}`;
}

const QUANTIDADE = /^\d{1,9}(\.\d{1,3})?$/;

function quantidade(valor: string | undefined): number | null {
  const limpo = (valor ?? "").trim().replace(",", ".");
  if (!limpo) return 0;
  return QUANTIDADE.test(limpo) ? milesimos(limpo) : null;
}

/** A OS nova vazia, para o dia pedido. */
function osVazia(data: string): OsNoPlano {
  return { data, inicio: "07:00", fim: "", itens: {} };
}

/** O plano inicial: uma OS com todo o saldo, para o dia de hoje. */
export function planoInicial(saldo: readonly LinhaDoSaldo[], hoje: string): FormularioDoPlano {
  const itens = Object.fromEntries(saldo.filter((linha) => milesimos(linha.saldo) > 0).map((linha) => [linha.id, linha.saldo]));
  return {
    ordens: [{ ...osVazia(hoje), itens }],
    equipe: [],
    veiculos: [],
    instrucoes: "",
    contatoOrigem: { nome: "", telefone: "" },
    contatoDestino: { nome: "", telefone: "" },
  };
}

/** Quanto de cada linha ainda sobra depois das OS do plano (em milésimos). */
export function restantes(saldo: readonly LinhaDoSaldo[], form: FormularioDoPlano): Map<string, number> {
  return new Map(
    saldo.map((linha) => {
      const noPlano = form.ordens.reduce((soma, os) => soma + (quantidade(os.itens[linha.id]) ?? 0), 0);
      return [linha.id, milesimos(linha.saldo) - noPlano];
    }),
  );
}

export function restanteEmTexto(valor: number): string {
  return deMilesimos(valor);
}

/** "Igualar ao saldo": a OS leva o que ela já tem mais o que sobra de cada linha. */
export function igualarAoSaldo(form: FormularioDoPlano, indice: number, saldo: readonly LinhaDoSaldo[]): FormularioDoPlano {
  const sobra = restantes(saldo, form);
  const os = form.ordens[indice];
  if (!os) return form;
  const itens = { ...os.itens };
  for (const linha of saldo) {
    const atual = quantidade(itens[linha.id]) ?? 0;
    const restante = sobra.get(linha.id) ?? 0;
    if (restante > 0) itens[linha.id] = deMilesimos(atual + restante);
  }
  return { ...form, ordens: form.ordens.map((item, posicao) => (posicao === indice ? { ...item, itens } : item)) };
}

/** Mais uma OS: o dia seguinte ao da última, sem itens; quem já está no plano entra nela. */
export function dividir(form: FormularioDoPlano): FormularioDoPlano {
  const ultima = form.ordens[form.ordens.length - 1];
  const dia = ultima?.data ? diaSeguinte(ultima.data) : "";
  const indice = form.ordens.length;
  return {
    ...form,
    ordens: [...form.ordens, { ...osVazia(dia), inicio: ultima?.inicio ?? "07:00", fim: ultima?.fim ?? "" }],
    equipe: form.equipe.map((pessoa) => ({ ...pessoa, ordens: [...pessoa.ordens, indice] })),
    veiculos: form.veiculos.map((veiculo) => ({ ...veiculo, ordens: [...veiculo.ordens, indice] })),
  };
}

function diaSeguinte(data: string): string {
  const dia = new Date(`${data}T12:00:00Z`);
  dia.setUTCDate(dia.getUTCDate() + 1);
  return dia.toISOString().slice(0, 10);
}

/** Tira a OS do plano; as outras mantêm a equipe e os veículos que tinham. */
export function removerOs(form: FormularioDoPlano, indice: number): FormularioDoPlano {
  if (form.ordens.length <= 1) return form;
  const reindexar = (ordens: number[]) => ordens.filter((item) => item !== indice).map((item) => (item > indice ? item - 1 : item));
  return {
    ...form,
    ordens: form.ordens.filter((_, posicao) => posicao !== indice),
    equipe: form.equipe.map((pessoa) => ({ ...pessoa, ordens: reindexar(pessoa.ordens) })),
    veiculos: form.veiculos.map((veiculo) => ({ ...veiculo, ordens: reindexar(veiculo.ordens) })),
  };
}

/** O papel que a pessoa leva: o primeiro dos marcados no cadastro, ou nenhum. */
export function papelInicial(pessoa: Pick<ColaboradorDaLista, "papeis">): PapelDeCampo | "" {
  return pessoa.papeis[0] ?? "";
}

/** Os papéis que se escolhem para a pessoa: os do cadastro ou, sem nenhum, todos. */
export function papeisDaPessoa(pessoa: Pick<ColaboradorDaLista, "papeis">): PapelDeCampo[] {
  return pessoa.papeis.length ? [...pessoa.papeis] : (Object.keys(PAPEL_ROTULO) as PapelDeCampo[]);
}

function rotuloDaOs(indice: number, total: number): string {
  return total > 1 ? `OS ${indice + 1}` : "A OS";
}

/**
 * O que impede de gravar, na ordem da tela. Ao agendar, toda OS precisa da
 * data; sem agendar (rascunho), a OS fica Para agendar.
 */
export function problemasDoPlano(form: FormularioDoPlano, saldo: readonly LinhaDoSaldo[], hoje: string, agendar: boolean): string[] {
  const problemas: string[] = [];
  const total = form.ordens.length;
  form.ordens.forEach((os, indice) => {
    const rotulo = rotuloDaOs(indice, total);
    const linhas = saldo.filter((linha) => (quantidade(os.itens[linha.id]) ?? 0) > 0);
    const invalidas = saldo.filter((linha) => quantidade(os.itens[linha.id]) === null);
    for (const linha of invalidas) problemas.push(`${rotulo}: a quantidade de ${linha.item} está fora do formato.`);
    if (!linhas.length && !invalidas.length) problemas.push(`${rotulo}: inclua ao menos um item.`);
    if (agendar && !os.data) problemas.push(`${rotulo}: informe a data.`);
    if (os.data && os.data < hoje) problemas.push(`${rotulo}: a data já passou.`);
    if (os.fim && !os.inicio) problemas.push(`${rotulo}: informe o início antes do fim.`);
    if (os.inicio && os.fim && os.fim <= os.inicio) problemas.push(`${rotulo}: o fim vem depois do início.`);
  });
  const sobra = restantes(saldo, form);
  for (const linha of saldo) {
    const restante = sobra.get(linha.id) ?? 0;
    if (restante < 0) problemas.push(`${linha.item}: as OS somam ${deMilesimos(milesimos(linha.saldo) - restante)} e o saldo é ${linha.saldo}.`);
  }
  return problemas;
}

/** O que merece atenção e não impede: sem equipe, sem veículo, sem líder e conflito no dia. */
export function alertasDoPlano(
  form: FormularioDoPlano,
  pessoas: readonly ColaboradorDaLista[],
  veiculos: readonly VeiculoDaLista[],
  outras: readonly OsDaFila[],
): string[] {
  const alertas: string[] = [];
  const total = form.ordens.length;
  const nomes = new Map(pessoas.map((pessoa) => [pessoa.id, pessoa.nome]));
  const placas = new Map(veiculos.map((veiculo) => [veiculo.id, veiculo.placa]));
  form.ordens.forEach((os, indice) => {
    const rotulo = rotuloDaOs(indice, total);
    const equipe = form.equipe.filter((pessoa) => pessoa.ordens.includes(indice));
    if (!equipe.length) alertas.push(`${rotulo} sem equipe`);
    else if (!equipe.some((pessoa) => pessoa.papel === "lider")) alertas.push(`${rotulo} sem líder`);
    if (!form.veiculos.some((veiculo) => veiculo.ordens.includes(indice))) alertas.push(`${rotulo} sem veículo`);
    if (!os.data) return;
    const doDia = outras.filter((outra) => (outra.status === "agendada" || outra.status === "em_execucao") && outra.agenda?.data === os.data);
    for (const pessoa of equipe) {
      const ocupada = doDia.find((outra) => (outra.pessoas?.map((item) => item.id) ?? outra.agenda?.equipe ?? []).includes(pessoa.colaboradorId));
      if (ocupada) alertas.push(`${nomes.get(pessoa.colaboradorId) ?? pessoa.colaboradorId} já está na OS ${ocupada.numero} no dia`);
    }
    for (const veiculo of form.veiculos.filter((item) => item.ordens.includes(indice))) {
      const ocupado = doDia.find((outra) => (outra.agenda?.veiculos ?? []).includes(veiculo.veiculoId));
      if (ocupado) alertas.push(`${placas.get(veiculo.veiculoId) ?? veiculo.veiculoId} já está na OS ${ocupado.numero} no dia`);
    }
  });
  return alertas;
}

function contato(valor: { nome: string; telefone: string }) {
  const nome = valor.nome.trim();
  return nome.length >= 2 ? { nome, telefone: valor.telefone.trim() || null } : undefined;
}

/**
 * O pedido para `saveServiceOrder` (action `plan`). Agendando, cada OS leva a
 * janela; no rascunho, sem janela (fica Para agendar). Só as linhas com
 * quantidade entram.
 */
export function pedidoDoPlano(
  form: FormularioDoPlano,
  demanda: string,
  saldo: readonly LinhaDoSaldo[],
  idempotencyKey: string,
  agendar: boolean,
): Record<string, unknown> {
  const contatoOrigem = contato(form.contatoOrigem);
  const contatoDestino = contato(form.contatoDestino);
  const contatos = contatoOrigem || contatoDestino ? { ...(contatoOrigem ? { origem: contatoOrigem } : {}), ...(contatoDestino ? { destino: contatoDestino } : {}) } : undefined;
  return {
    action: "plan",
    idempotency_key: idempotencyKey,
    demanda,
    ordens: form.ordens.map((os, indice) => ({
      itens: saldo.flatMap((linha) => {
        const valor = quantidade(os.itens[linha.id]) ?? 0;
        return valor > 0 ? [{ id: linha.id, planejado: deMilesimos(valor) }] : [];
      }),
      ...(agendar && os.data ? { janela: { data: os.data, inicio: os.inicio || null, fim: os.fim || null } } : {}),
      equipe: form.equipe
        .filter((pessoa) => pessoa.ordens.includes(indice))
        .map((pessoa) => ({ colaborador_id: pessoa.colaboradorId, ...(pessoa.papel ? { papel: pessoa.papel } : {}) })),
      veiculos: form.veiculos.filter((veiculo) => veiculo.ordens.includes(indice)).map((veiculo) => veiculo.veiculoId),
      ...(form.instrucoes.trim() ? { instrucoes: form.instrucoes.trim() } : {}),
      ...(contatos ? { contatos } : {}),
    })),
  };
}
