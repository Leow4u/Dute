import { estagioDoCadastro, type EstagioCadastro } from "@workspace/dominio";

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
  /** Mês e ano da troca de estágio (ou da criação): "10/2026". */
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

export function desdeQuando(data: Registro): string | null {
  const date = paraData(data.stage_changed_at) ?? paraData(data.created_at);
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

/**
 * Contatos por empresa: a do cliente primeiro (contato sem empresa é do
 * cliente), depois as gerenciadoras por nome. Dentro do grupo, ativos
 * primeiro e por nome.
 */
export function gruposDeContatos(contatos: readonly ContatoResumo[], nomeDoCliente: string): GrupoDeContatos[] {
  const doCliente = canonico(nomeDoCliente);
  const grupos = new Map<string, GrupoDeContatos>();
  for (const contato of contatos) {
    const chave = contato.empresa ? canonico(contato.empresa) : doCliente;
    const cliente = !contato.empresa || chave === doCliente;
    const grupo = grupos.get(cliente ? doCliente : chave) ?? {
      empresa: cliente ? nomeDoCliente : contato.empresa!,
      tipo: cliente ? ("Cliente" as const) : ("Gerenciadora" as const),
      pessoas: [],
    };
    grupo.pessoas.push(contato);
    grupos.set(cliente ? doCliente : chave, grupo);
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

/** Empresas dos contatos (para sugerir no campo Empresa), sem repetir. */
export function empresasDosContatos(contatos: readonly ContatoResumo[]): string[] {
  const vistas = new Map<string, string>();
  for (const contato of contatos) {
    if (contato.empresa && !vistas.has(canonico(contato.empresa))) vistas.set(canonico(contato.empresa), contato.empresa);
  }
  return [...vistas.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
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
 * saveCommercialCustomer, update. Cadastro com armazenagem só muda cidade e
 * UF aqui: nome, razão social e CNPJ se editam em Configurações › Clientes.
 */
export function payloadEdicao(cadastro: CadastroComercial, form: FormEdicao, idempotencyKey: string): Registro {
  return {
    action: "update",
    idempotency_key: idempotencyKey,
    customer_code: cadastro.code,
    ...(cadastro.armazenagem
      ? {}
      : { name: texto(form.nome), legal_name: opcional(form.razaoSocial), document: opcional(form.cnpj) }),
    comercial: { cidade: opcional(form.cidade), uf: opcional(form.uf) },
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

/** saveCustomerLocation. Sem nenhuma parte do endereço, o endereço é null. */
export function payloadLocal(customerCode: string, form: FormLocal, idempotencyKey: string, localId?: string): Registro {
  const endereco = Object.fromEntries(CAMPOS_DO_ENDERECO.map((campo) => [campo, opcional(form[campo])]));
  const temEndereco = Object.values(endereco).some(Boolean);
  const sigla = texto(form.sigla).toUpperCase();
  return {
    idempotency_key: idempotencyKey,
    customer_code: customerCode,
    ...(localId ? { local_id: localId } : {}),
    nome: texto(form.nome),
    sigla: sigla || null,
    endereco: temEndereco ? endereco : null,
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

/** saveCustomerContact. Papel não escolhido: "outro", o padrão do servidor. */
export function payloadContato(customerCode: string, form: FormContato, idempotencyKey: string, contatoId?: string): Registro {
  return {
    idempotency_key: idempotencyKey,
    customer_code: customerCode,
    ...(contatoId ? { contato_id: contatoId } : {}),
    nome: texto(form.nome),
    email: opcional(form.email),
    telefone: opcional(form.telefone),
    empresa: opcional(form.empresa),
    papel: papelDoContato(form.papel),
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
