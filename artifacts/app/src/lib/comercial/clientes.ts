import { estagioDoCadastro, type EstagioCadastro } from "@workspace/dominio";

import { getRouteProfileRoles } from "../modules";
import { LEGACY_CUSTOMER_CODE, canonicalSkuPrefix } from "../operations";
import { CUSTOMER_CODE_PATTERN } from "./codigo";

/**
 * Regras puras da tela de Clientes e prospects do Comercial
 * (docs/mockups/ComClientes.dc.html; docs/plataforma/fase-6-comercial.md,
 * parte 13): o cadastro lido do Firestore (`customers`, `contracts`,
 * `customer_locations`, `customer_contacts`), os segmentos e a busca, o
 * contrato vigente, os contatos por empresa e as chamadas das callables de
 * functions/comercial (domain/cadastro.ts, entrada `.strict()`).
 *
 * A tela lê pelo Firestore (as regras abrem o cadastro a owner, admin e
 * comercial, e contratos por canReadPrices()) e grava só pelas callables.
 */

type Registro = Record<string, unknown>;

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function opcional(value: unknown): string | null {
  return texto(value) || null;
}

function isRegistro(value: unknown): value is Registro {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Sem acento e em minúsculas: a busca não diferencia "Itaú" de "itau". */
function semAcento(value: unknown): string {
  return texto(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Maiúsculas, sem acento e só letras e números, como o código canônico do servidor. */
function canonico(value: unknown): string {
  return semAcento(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const UM_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2027-06-30" → "30/06/2027". Texto fora do formato fica como está. */
export function dataBr(value: string): string {
  const match = UM_DIA.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

/** Hoje como "AAAA-MM-DD", no fuso de quem usa (o dia do calendário, como no contrato). */
export function hojeLocal(date: Date = new Date()): string {
  const mes = String(date.getMonth() + 1).padStart(2, "0");
  const dia = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mes}-${dia}`;
}

function paraData(value: unknown): Date | null {
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (isRegistro(value) && typeof value.toDate === "function") date = (value.toDate as () => Date)();
  else if (isRegistro(value) && typeof value.seconds === "number") date = new Date(value.seconds * 1000);
  else if (typeof value === "string" || typeof value === "number") date = new Date(value);
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/** Leitura ao vivo do Firestore: os itens, ainda carregando ou com erro (nunca vira lista vazia). */
export type Carga<T> = T[] | "carregando" | "erro";

// --- Cadastro -------------------------------------------------------------------

export type CadastroComercial = {
  /** Id do documento em `customers`. */
  id: string;
  /** Código real do cliente (`customer_code`, ou `code` no cadastro antigo): o que as callables recebem. */
  code: string;
  nome: string;
  razaoSocial: string | null;
  /** CNPJ como está gravado. */
  cnpj: string | null;
  estagio: EstagioCadastro;
  /** Tem sigla do SKU ou é a BTG: a identidade se edita em Configurações › Clientes. */
  armazenagem: boolean;
  cidade: string | null;
  uf: string | null;
  responsavelUid: string | null;
  /** Mês e ano em que virou prospect ou cliente pelo Comercial: "10/2026". */
  desde: string | null;
};

function arquivado(data: Registro): boolean {
  return data.archived === true || texto(data.status) === "archived";
}

/**
 * Cadastro que o WMS opera (sigla do SKU) ou a BTG, que pode não ter sigla.
 * O servidor confere também a projeção do portal, que o comercial não lê:
 * se ele recusar, a mensagem dele aparece.
 */
function temArmazenagem(data: Registro): boolean {
  if (canonicalSkuPrefix(texto(data.sku_prefix))) return true;
  const legado = canonico(LEGACY_CUSTOMER_CODE);
  return [data.code, data.customer_code].some((code) => canonico(code) === legado);
}

/**
 * Desde quando é prospect (a troca de estágio ou a criação) ou cliente. Para
 * cliente, só a troca que o Comercial registrou ao marcar: o cadastro do WMS
 * não diz quando a relação começou, e a data do registro não é esse início.
 */
export function desdeQuando(data: Registro): string | null {
  const date =
    estagioDoCadastro(data.stage) === "prospect"
      ? (paraData(data.stage_changed_at) ?? paraData(data.created_at))
      : texto(data.stage) === "cliente"
        ? paraData(data.stage_changed_at)
        : null;
  if (!date) return null;
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

/** Documento de `customers` para a tela; arquivado (pelo WMS ou pelo Comercial) não entra. */
export function cadastroDoDocumento(id: string, data: Registro): CadastroComercial | null {
  if (arquivado(data)) return null;
  const code = texto(data.customer_code) || texto(data.code) || id;
  const comercial = isRegistro(data.comercial) ? data.comercial : {};
  return {
    id,
    code,
    nome: texto(data.name) || code,
    razaoSocial: opcional(data.legal_name),
    cnpj: opcional(data.document),
    estagio: estagioDoCadastro(data.stage),
    armazenagem: temArmazenagem(data),
    cidade: opcional(comercial.cidade),
    uf: opcional(comercial.uf),
    responsavelUid: opcional(comercial.responsavel_uid),
    desde: desdeQuando(data),
  };
}

// --- Segmentos e busca ------------------------------------------------------------

export const SEGMENTOS = ["todos", "clientes", "prospects"] as const;
export type Segmento = (typeof SEGMENTOS)[number];
export type Contagem = Record<Segmento, number>;

export function contarSegmentos(cadastros: readonly CadastroComercial[]): Contagem {
  const prospects = cadastros.filter((cadastro) => cadastro.estagio === "prospect").length;
  return { todos: cadastros.length, clientes: cadastros.length - prospects, prospects };
}

function porNome(a: CadastroComercial, b: CadastroComercial): number {
  return a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }) || a.id.localeCompare(b.id);
}

/** Busca por nome ou razão social (sem acento) e, com dois algarismos ou mais, pelo CNPJ. */
function correspondeABusca(cadastro: CadastroComercial, busca: string): boolean {
  const termo = semAcento(busca);
  if (!termo) return true;
  if (semAcento(cadastro.nome).includes(termo) || semAcento(cadastro.razaoSocial).includes(termo)) return true;
  const digitos = busca.replace(/\D/g, "");
  return digitos.length >= 2 && texto(cadastro.cnpj).replace(/\D/g, "").includes(digitos);
}

/** Clientes e prospects do segmento que batem com a busca, cada grupo por nome. */
export function filtrarCadastros(
  cadastros: readonly CadastroComercial[],
  segmento: Segmento,
  busca: string,
): { clientes: CadastroComercial[]; prospects: CadastroComercial[] } {
  const achados = cadastros.filter((cadastro) => correspondeABusca(cadastro, busca)).sort(porNome);
  return {
    clientes: segmento === "prospects" ? [] : achados.filter((cadastro) => cadastro.estagio === "cliente"),
    prospects: segmento === "clientes" ? [] : achados.filter((cadastro) => cadastro.estagio === "prospect"),
  };
}

// --- Apresentação -------------------------------------------------------------------

const CONECTIVOS = new Set(["DE", "DA", "DO", "DAS", "DOS", "E"]);

/** Iniciais do nome: primeira letra das duas primeiras palavras, sem conectivo ("Banco do Brasil" → BB). */
export function iniciais(nome: string): string {
  const palavras = texto(nome)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((palavra) => palavra && !CONECTIVOS.has(palavra));
  if (!palavras.length) return "?";
  if (palavras.length === 1) return palavras[0].slice(0, 2);
  return `${palavras[0][0]}${palavras[1][0]}`;
}

/** CNPJ com máscara (numérico ou alfanumérico); texto que não tem 14 caracteres fica como está. */
export function formatarCnpj(value: string | null | undefined): string {
  const bruto = texto(value);
  const limpo = bruto.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (limpo.length !== 14) return bruto;
  return `${limpo.slice(0, 2)}.${limpo.slice(2, 5)}.${limpo.slice(5, 8)}/${limpo.slice(8, 12)}-${limpo.slice(12)}`;
}

/** Telefone como o servidor grava (só algarismos) com máscara: "(11) 99999-0000". Outro formato fica como está. */
export function formatarTelefone(value: string | null | undefined): string {
  const bruto = texto(value);
  if (!/^\d{10,11}$/.test(bruto)) return bruto;
  const meio = bruto.length === 11 ? 7 : 6;
  return `(${bruto.slice(0, 2)}) ${bruto.slice(2, meio)}-${bruto.slice(meio)}`;
}

export function cidadeUf(cidade: string | null, uf: string | null): string {
  return [cidade, uf].filter(Boolean).join("/");
}

export type Endereco = {
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  cep?: string | null;
};

/** "Av. Paulista, 2100, 5º andar · Bela Vista · São Paulo/SP · 01310-100". */
export function enderecoEmLinha(endereco: Endereco | null | undefined): string {
  if (!endereco) return "";
  const rua = [endereco.logradouro, endereco.numero, endereco.complemento].map(texto).filter(Boolean).join(", ");
  const cidade = cidadeUf(opcional(endereco.cidade), opcional(endereco.uf));
  return [rua, texto(endereco.bairro), cidade, texto(endereco.cep)].filter(Boolean).join(" · ");
}

// --- Contratos ---------------------------------------------------------------------

export type ContratoResumo = {
  id: string;
  customerCode: string;
  nome: string;
  numeros: string[];
  vigenteDe: string;
  /** null: prazo indeterminado. */
  vigenteAte: string | null;
  status: "vigente" | "encerrado";
};

/** Documento de `contracts` (functions/comercial, parte 8), sem preço: o contrato não guarda valor. */
export function contratoDoDocumento(id: string, data: Registro): ContratoResumo | null {
  const customerCode = texto(data.customer_code);
  const vigenteDe = texto(data.vigente_de);
  if (!customerCode || !UM_DIA.test(vigenteDe)) return null;
  const vigenteAte = texto(data.vigente_ate);
  const numeros = Array.isArray(data.numeros)
    ? data.numeros.map((item) => (isRegistro(item) ? texto(item.numero) : "")).filter(Boolean)
    : [];
  return {
    id,
    customerCode,
    nome: texto(data.nome) || id,
    numeros,
    vigenteDe,
    vigenteAte: UM_DIA.test(vigenteAte) ? vigenteAte : null,
    status: texto(data.status) === "encerrado" ? "encerrado" : "vigente",
  };
}

function emVigor(contrato: ContratoResumo, hoje: string): boolean {
  return (
    contrato.status === "vigente" &&
    contrato.vigenteDe <= hoje &&
    (contrato.vigenteAte === null || contrato.vigenteAte >= hoje)
  );
}

/** O contrato em vigor hoje; com mais de um, o que vai mais longe (sem prazo vence todos). */
export function contratoVigente(
  contratos: readonly ContratoResumo[],
  customerCode: string,
  hoje: string,
): ContratoResumo | null {
  const vigentes = contratos.filter((contrato) => contrato.customerCode === customerCode && emVigor(contrato, hoje));
  vigentes.sort((a, b) => (b.vigenteAte ?? "9999-12-31").localeCompare(a.vigenteAte ?? "9999-12-31"));
  return vigentes[0] ?? null;
}

export function rotuloDoContrato(contrato: ContratoResumo | null): string {
  if (!contrato) return "Sem contrato";
  return contrato.vigenteAte ? `Contrato até ${dataBr(contrato.vigenteAte)}` : "Contrato sem prazo";
}

export function vigenciaDoContrato(contrato: ContratoResumo): string {
  return contrato.vigenteAte
    ? `${dataBr(contrato.vigenteDe)} a ${dataBr(contrato.vigenteAte)}`
    : `Desde ${dataBr(contrato.vigenteDe)}`;
}

export type SituacaoDoContrato = "Vigente" | "A iniciar" | "Vencido" | "Encerrado";

/** Situação de hoje: encerrado pelo status; vigente pelo status e pelas datas. */
export function situacaoDoContrato(contrato: ContratoResumo, hoje: string): SituacaoDoContrato {
  if (contrato.status === "encerrado") return "Encerrado";
  if (contrato.vigenteDe > hoje) return "A iniciar";
  if (contrato.vigenteAte !== null && contrato.vigenteAte < hoje) return "Vencido";
  return "Vigente";
}

/** Contratos do cliente, o mais novo primeiro. */
export function contratosDoCliente(contratos: readonly ContratoResumo[], customerCode: string): ContratoResumo[] {
  return contratos
    .filter((contrato) => contrato.customerCode === customerCode)
    .sort((a, b) => b.vigenteDe.localeCompare(a.vigenteDe) || a.id.localeCompare(b.id));
}

// --- Locais e contatos ---------------------------------------------------------------

export type LocalResumo = {
  id: string;
  nome: string;
  sigla: string | null;
  endereco: Endereco | null;
  ativo: boolean;
};

export function localDoDocumento(id: string, data: Registro): LocalResumo | null {
  const nome = texto(data.nome);
  if (!nome) return null;
  return {
    id,
    nome,
    sigla: opcional(data.sigla),
    endereco: isRegistro(data.endereco) ? (data.endereco as Endereco) : null,
    ativo: data.ativo !== false,
  };
}

/** Ativos primeiro, depois pela sigla e pelo nome. */
export function ordenarLocais(locais: readonly LocalResumo[]): LocalResumo[] {
  return [...locais].sort(
    (a, b) =>
      Number(b.ativo) - Number(a.ativo) ||
      (a.sigla ?? "￿").localeCompare(b.sigla ?? "￿") ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  );
}

export const PAPEIS_DO_CONTATO = ["gestor_cliente", "gerenciadora", "financeiro", "outro"] as const;
export type PapelDoContato = (typeof PAPEIS_DO_CONTATO)[number];

export const PAPEL_DO_CONTATO_ROTULO: Record<PapelDoContato, string> = {
  gestor_cliente: "Gestor do cliente",
  gerenciadora: "Gerenciadora",
  financeiro: "Financeiro",
  outro: "Outro",
};

export type ContatoResumo = {
  id: string;
  customerCode: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  papel: PapelDoContato;
  papelRotulo: string;
  ativo: boolean;
};

function papelDoContato(value: unknown): PapelDoContato {
  const papel = texto(value);
  return (PAPEIS_DO_CONTATO as readonly string[]).includes(papel) ? (papel as PapelDoContato) : "outro";
}

export function contatoDoDocumento(id: string, data: Registro): ContatoResumo | null {
  const nome = texto(data.nome);
  if (!nome) return null;
  const papel = papelDoContato(data.papel);
  return {
    id,
    customerCode: texto(data.customer_code),
    nome,
    email: opcional(data.email),
    telefone: opcional(data.telefone),
    empresa: opcional(data.empresa),
    papel,
    papelRotulo: PAPEL_DO_CONTATO_ROTULO[papel],
    ativo: data.ativo !== false,
  };
}

export type GrupoDeContatos = {
  empresa: string;
  tipo: "Cliente" | "Gerenciadora";
  pessoas: ContatoResumo[];
};

/** Grupo da gerenciadora sem empresa informada. */
export const SEM_EMPRESA = "Sem empresa";

/** Chave da empresa: sem acento, conectivo nem sufixo societário ("Souza e Lopes Ltda" = "Souza & Lopes"). */
function chaveDaEmpresa(value: unknown): string {
  return palavrasDoNome(value).join("");
}

/** A mesma empresa: chave igual, ou uma contida na outra com 4 letras ou mais ("Itaú" e "Itaú Unibanco"). */
function mesmaEmpresa(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [menor, maior] = a.length <= b.length ? [a, b] : [b, a];
  return menor.length >= 4 && maior.includes(menor);
}

type IdentidadeDoCliente = Pick<CadastroComercial, "nome" | "razaoSocial">;

/**
 * Contato do próprio cliente: sem empresa ou com a empresa do cadastro (pelo
 * nome ou pela razão social, mesmo abreviada). Quem tem papel de
 * gerenciadora nunca é do cliente.
 */
function ehDoCliente(contato: ContatoResumo, cliente: IdentidadeDoCliente): boolean {
  if (contato.papel === "gerenciadora") return false;
  if (!contato.empresa) return true;
  const chave = chaveDaEmpresa(contato.empresa);
  return [cliente.nome, cliente.razaoSocial].some((nome) => mesmaEmpresa(chave, chaveDaEmpresa(nome)));
}

/**
 * Contatos por empresa: a do cliente primeiro, depois as gerenciadoras por
 * nome (a mesma empresa escrita de jeitos diferentes fica num grupo só, com o
 * nome como apareceu primeiro). Dentro do grupo, ativos primeiro e por nome.
 */
export function gruposDeContatos(contatos: readonly ContatoResumo[], cliente: IdentidadeDoCliente): GrupoDeContatos[] {
  // A chave da empresa só tem letras maiúsculas e números: esta não colide.
  const DO_CLIENTE = "#cliente";
  const grupos = new Map<string, GrupoDeContatos>();
  for (const contato of contatos) {
    const doCliente = ehDoCliente(contato, cliente);
    const chave = doCliente ? DO_CLIENTE : chaveDaEmpresa(contato.empresa);
    const grupo = grupos.get(chave) ?? {
      empresa: doCliente ? cliente.nome : (contato.empresa ?? SEM_EMPRESA),
      tipo: doCliente ? ("Cliente" as const) : ("Gerenciadora" as const),
      pessoas: [],
    };
    grupo.pessoas.push(contato);
    grupos.set(chave, grupo);
  }
  const lista = [...grupos.values()];
  for (const grupo of lista) {
    grupo.pessoas.sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, "pt-BR"));
  }
  return lista.sort(
    (a, b) =>
      Number(b.tipo === "Cliente") - Number(a.tipo === "Cliente") ||
      a.empresa.localeCompare(b.empresa, "pt-BR", { sensitivity: "base" }),
  );
}

/**
 * Sugestões do campo Empresa: o nome do cliente e as gerenciadoras já usadas
 * em todos os clientes, sem repetir a mesma empresa escrita de outro jeito (a
 * forma usada neste cliente vem primeiro). A empresa própria de cada cliente
 * não entra.
 */
export function empresasSugeridas(
  contatos: readonly ContatoResumo[],
  cadastros: readonly CadastroComercial[],
  cliente: CadastroComercial,
): string[] {
  const porCodigo = new Map(cadastros.map((cadastro) => [cadastro.code, cadastro]));
  const vistas = new Map<string, string>([[chaveDaEmpresa(cliente.nome), cliente.nome]]);
  const ordem = [...contatos].sort(
    (a, b) => Number(b.customerCode === cliente.code) - Number(a.customerCode === cliente.code),
  );
  for (const contato of ordem) {
    if (!contato.empresa) continue;
    const dono = porCodigo.get(contato.customerCode);
    if (dono && ehDoCliente(contato, dono)) continue;
    const chave = chaveDaEmpresa(contato.empresa);
    if (chave && ![...vistas.keys()].some((vista) => mesmaEmpresa(vista, chave))) vistas.set(chave, contato.empresa);
  }
  const [doCliente, ...gerenciadoras] = [...vistas.values()];
  return [doCliente, ...gerenciadoras.sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }))];
}

// --- Nome parecido ---------------------------------------------------------------------

const SUFIXOS = new Set(["LTDA", "SA", "S", "A", "ME", "EPP", "EIRELI", "MEI", "SS"]);

/** Palavras que muitas empresas têm: sozinhas não fazem dois nomes parecidos. */
const GENERICAS = new Set([
  "BANCO",
  "GRUPO",
  "COMPANHIA",
  "CIA",
  "EMPRESA",
  "BRASIL",
  "BRASILEIRA",
  "SERVICOS",
  "SEGUROS",
  "ENGENHARIA",
  "CONSTRUTORA",
  "COMERCIO",
  "INDUSTRIA",
  "PARTICIPACOES",
  "HOLDING",
  "SOCIEDADE",
  "ADVOGADOS",
  "ADVOCACIA",
  "LOGISTICA",
  "SOLUCOES",
  "TECNOLOGIA",
  "SISTEMAS",
  "INVESTIMENTOS",
  "ASSOCIACAO",
  "INSTITUTO",
  "FUNDACAO",
]);

function palavrasDoNome(value: unknown): string[] {
  const palavras = semAcento(value)
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((palavra) => palavra && !CONECTIVOS.has(palavra));
  while (palavras.length > 1 && SUFIXOS.has(palavras[palavras.length - 1])) palavras.pop();
  return palavras;
}

function parecido(a: string[], b: string[]): boolean {
  const juntoA = a.join("");
  const juntoB = b.join("");
  if (!juntoA || !juntoB) return false;
  if (juntoA === juntoB) return true;
  const [menor, maior] = juntoA.length <= juntoB.length ? [juntoA, juntoB] : [juntoB, juntoA];
  if (menor.length >= 4 && maior.includes(menor)) return true;
  const proprias = (palavras: string[]) => palavras.filter((palavra) => palavra.length >= 3 && !GENERICAS.has(palavra));
  const deB = new Set(proprias(b));
  return proprias(a).some((palavra) => deB.has(palavra));
}

/**
 * Cadastros com nome (ou razão social) parecido com o do prospect novo, para
 * o aviso antes de criar. O servidor recusa só código e raiz de CNPJ
 * repetidos; nome parecido é decisão de quem cadastra.
 */
export function nomesParecidos(nome: string, cadastros: readonly CadastroComercial[], limite = 3): CadastroComercial[] {
  const alvo = palavrasDoNome(nome);
  if (!alvo.join("")) return [];
  return cadastros
    .filter((cadastro) => parecido(alvo, palavrasDoNome(cadastro.nome)) || parecido(alvo, palavrasDoNome(cadastro.razaoSocial)))
    .sort(porNome)
    .slice(0, limite);
}

// --- Chamadas das callables -----------------------------------------------------------

/** As UFs que a callable aceita (functions/comercial, domain/cadastro.ts). */
export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;

export function problemaDoCodigo(codigo: string): string | null {
  const code = texto(codigo).toUpperCase();
  if (!code) return null;
  return CUSTOMER_CODE_PATTERN.test(code)
    ? null
    : "Use letras sem acento, números e hífen, de 2 a 20 caracteres, começando por letra ou número.";
}

export type FormNovoProspect = { nome: string; codigo: string; cnpj: string; cidade: string; uf: string };

/** saveCommercialCustomer, create. Código vazio: o servidor sugere pelo nome. */
export function payloadNovoProspect(form: FormNovoProspect, idempotencyKey: string): Registro {
  const code = texto(form.codigo).toUpperCase();
  const cnpj = texto(form.cnpj);
  return {
    action: "create",
    idempotency_key: idempotencyKey,
    name: texto(form.nome),
    ...(code ? { code } : {}),
    ...(cnpj ? { document: cnpj } : {}),
    comercial: { cidade: opcional(form.cidade), uf: opcional(form.uf) },
  };
}

export type FormEdicao = { nome: string; razaoSocial: string; cnpj: string; cidade: string; uf: string };

/**
 * Campos que mudaram entre o formulário de abertura e o enviado. A callable
 * não recebe o estado esperado (entrada `.strict()`, sem versão) e mantém o
 * que não vem: mandar só o que a pessoa mudou evita desfazer, com o valor
 * velho da tela, o que outra pessoa gravou nesse meio-tempo.
 */
function alterados<F extends Record<K, string>, K extends string>(antes: F, depois: F, campos: readonly K[]): K[] {
  return campos.filter((campo) => texto(depois[campo]) !== texto(antes[campo]));
}

/** Formulário de edição como abre: o cadastro que a pessoa vê. */
export function formDaEdicao(cadastro: CadastroComercial): FormEdicao {
  return {
    nome: cadastro.nome,
    razaoSocial: cadastro.razaoSocial ?? "",
    cnpj: cadastro.cnpj ?? "",
    cidade: cadastro.cidade ?? "",
    uf: cadastro.uf ?? "",
  };
}

/**
 * saveCommercialCustomer, update: só o que mudou desde a abertura (`cadastro`
 * é o de quando o diálogo abriu). Cadastro com armazenagem só muda cidade e
 * UF aqui: nome, razão social e CNPJ se editam em Configurações › Clientes.
 */
export function payloadEdicao(cadastro: CadastroComercial, form: FormEdicao, idempotencyKey: string): Registro {
  const antes = formDaEdicao(cadastro);
  const identidade = cadastro.armazenagem ? [] : alterados(antes, form, ["nome", "razaoSocial", "cnpj"] as const);
  const comercial = alterados(antes, form, ["cidade", "uf"] as const);
  return {
    action: "update",
    idempotency_key: idempotencyKey,
    customer_code: cadastro.code,
    ...(identidade.includes("nome") ? { name: texto(form.nome) } : {}),
    ...(identidade.includes("razaoSocial") ? { legal_name: opcional(form.razaoSocial) } : {}),
    ...(identidade.includes("cnpj") ? { document: opcional(form.cnpj) } : {}),
    ...(comercial.length ? { comercial: Object.fromEntries(comercial.map((campo) => [campo, opcional(form[campo])])) } : {}),
  };
}

/** Tela do WMS onde se edita a identidade do cadastro com armazenagem. */
export const ROTA_CADASTRO_DO_WMS = "/configuracoes/clientes";

export type AvisoDaIdentidade = { texto: string; link: { href: string; rotulo: string } | null };

/**
 * Aviso do cadastro com armazenagem: quem abre Configurações › Clientes vai
 * até lá pelo link; quem não abre (o comercial) fica sabendo quem edita.
 */
export function avisoDaIdentidade(role: unknown): AvisoDaIdentidade {
  const quemEdita = getRouteProfileRoles(ROTA_CADASTRO_DO_WMS);
  if ((quemEdita as readonly unknown[]).includes(role)) {
    return {
      texto: "Nome, razão social e CNPJ deste cadastro se editam em",
      link: { href: ROTA_CADASTRO_DO_WMS, rotulo: "Configurações › Clientes" },
    };
  }
  return {
    texto: `Nome, razão social e CNPJ deste cadastro só o ${quemEdita.join(" ou o ")} editam, em Configurações › Clientes.`,
    link: null,
  };
}

/** saveCommercialCustomer, mark_client: o servidor só aceita de prospect. */
export function payloadMarcarCliente(cadastro: CadastroComercial, idempotencyKey: string): Registro {
  return { action: "mark_client", idempotency_key: idempotencyKey, customer_code: cadastro.code };
}

export type FormLocal = {
  nome: string;
  sigla: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
};

const CAMPOS_DO_ENDERECO = ["logradouro", "numero", "complemento", "bairro", "cidade", "uf", "cep"] as const;

/** Formulário do local como abre: vazio para o novo, o local para a alteração. */
export function formDoLocal(local: LocalResumo | null): FormLocal {
  const endereco: Endereco = local?.endereco ?? {};
  return {
    nome: local?.nome ?? "",
    sigla: local?.sigla ?? "",
    logradouro: texto(endereco.logradouro),
    numero: texto(endereco.numero),
    complemento: texto(endereco.complemento),
    bairro: texto(endereco.bairro),
    cidade: texto(endereco.cidade),
    uf: texto(endereco.uf),
    cep: texto(endereco.cep),
  };
}

/**
 * saveCustomerLocation. Sem nenhuma parte do endereço, o endereço é null.
 * Na alteração (`original`, o local de quando o diálogo abriu) vão o id, o
 * nome (obrigatório na callable) e só o que mudou: a callable mantém o resto,
 * inclusive cada parte do endereço.
 */
export function payloadLocal(
  customerCode: string,
  form: FormLocal,
  idempotencyKey: string,
  original?: LocalResumo | null,
): Registro {
  const sigla = texto(form.sigla).toUpperCase() || null;
  const temEndereco = CAMPOS_DO_ENDERECO.some((campo) => texto(form[campo]));
  const base = { idempotency_key: idempotencyKey, customer_code: customerCode };
  if (!original) {
    const endereco = Object.fromEntries(CAMPOS_DO_ENDERECO.map((campo) => [campo, opcional(form[campo])]));
    return { ...base, nome: texto(form.nome), sigla, endereco: temEndereco ? endereco : null };
  }
  const antes = formDoLocal(original);
  const endereco = alterados(antes, form, CAMPOS_DO_ENDERECO);
  return {
    ...base,
    local_id: original.id,
    nome: texto(form.nome),
    ...(texto(antes.sigla).toUpperCase() !== (sigla ?? "") ? { sigla } : {}),
    ...(endereco.length
      ? { endereco: temEndereco ? Object.fromEntries(endereco.map((campo) => [campo, opcional(form[campo])])) : null }
      : {}),
  };
}

export function payloadAtivoLocal(
  customerCode: string,
  local: Pick<LocalResumo, "id" | "nome">,
  ativo: boolean,
  idempotencyKey: string,
): Registro {
  return { idempotency_key: idempotencyKey, customer_code: customerCode, local_id: local.id, nome: local.nome, ativo };
}

export type FormContato = { nome: string; empresa: string; papel: string; email: string; telefone: string };

/** Formulário do contato como abre: vazio para o novo, o contato para a alteração. */
export function formDoContato(contato: ContatoResumo | null): FormContato {
  return {
    nome: contato?.nome ?? "",
    empresa: contato?.empresa ?? "",
    papel: contato?.papel ?? "",
    email: contato?.email ?? "",
    telefone: contato?.telefone ?? "",
  };
}

/**
 * saveCustomerContact. Papel não escolhido: "outro", o padrão do servidor. Na
 * alteração (`original`, o contato de quando o diálogo abriu) vão o id, o nome
 * (obrigatório na callable) e só o que mudou.
 */
export function payloadContato(
  customerCode: string,
  form: FormContato,
  idempotencyKey: string,
  original?: ContatoResumo | null,
): Registro {
  const valores = {
    email: opcional(form.email),
    telefone: opcional(form.telefone),
    empresa: opcional(form.empresa),
    papel: papelDoContato(form.papel),
  };
  const base = { idempotency_key: idempotencyKey, customer_code: customerCode };
  if (!original) return { ...base, nome: texto(form.nome), ...valores };
  const campos = alterados(formDoContato(original), form, ["email", "telefone", "empresa", "papel"] as const);
  return {
    ...base,
    contato_id: original.id,
    nome: texto(form.nome),
    ...Object.fromEntries(campos.map((campo) => [campo, valores[campo]])),
  };
}

export function payloadAtivoContato(
  customerCode: string,
  contato: Pick<ContatoResumo, "id" | "nome">,
  ativo: boolean,
  idempotencyKey: string,
): Registro {
  return { idempotency_key: idempotencyKey, customer_code: customerCode, contato_id: contato.id, nome: contato.nome, ativo };
}
