// Cópia literal de lib/dominio/src/nome-do-produto.ts: não edite aqui (trava em nome-do-produto.test.ts).
/**
 * O padrão do nome do produto, decidido pelo Leonardo em 06/11/2026 (mockups
 * em docs/mockups/Nome*.dc.html, canvas "Catálogo · nome sem tamanho"):
 *
 * 1. O nome é o mesmo em todos os tamanhos da família: o tamanho sai do fim do
 *    nome e vai para o campo Tamanho, preenchido pelo fim do código do cliente
 *    (A.01.0806.005.XG → XG).
 * 2. O gênero é uma etiqueta igual para tudo, "Masculino" ou "Feminino", sem
 *    concordar com a peça ("Polo Masculino", "Calça Social Masculino").
 * 3. Inicial maiúscula em cada palavra; conectivos (de, da, com, e) em
 *    minúscula; siglas (BTG) em maiúsculas; unidade depois de número em
 *    minúscula ("500 ml"); cores compostas com hífen ("Azul-Marinho").
 * 4. Nada além disso: a regra não reordena palavras, não acrescenta cor nem
 *    corrige digitação. O que ela não resolve sozinha vira "conferir".
 *
 * Funções puras, sem Firestore. tools/padronizar-nomes/regras.mjs guarda uma
 * cópia em JavaScript, e os dois rodam os mesmos casos de
 * nome-do-produto.casos.json (vitest do app e node --test da ferramenta).
 */

/** Os tamanhos de roupa na ordem natural; N1… e os números vêm depois. */
export const TAMANHOS_DE_ROUPA = ["PP", "P", "M", "G", "GG", "XG", "XGG", "XXG", "XXXG", "EG", "EGG", "EXG", "XS", "S", "L", "XL", "XXL", "U"] as const;

/** Siglas que ficam em maiúsculas no nome. */
export const SIGLAS = new Set(["BTG", "PAN", "SW", "UV", "UVA", "UVB", "LED", "USB", "PVC", "PET", "GPS", "TV", "PC", "SP", "RJ", "MG", "DF", "BR"]);

/** Conectivos em minúscula, exceto na primeira palavra. */
export const CONECTIVOS = new Set(["de", "da", "do", "das", "dos", "e", "em", "com", "sem", "para", "a", "o", "ao", "aos", "à", "às", "na", "no", "nas", "nos", "por", "pelo", "pela", "pelos", "pelas", "ou"]);

/** Unidades em minúscula quando vêm depois de um número ("500 ml"). */
export const UNIDADES = new Set(["ml", "l", "kg", "g", "cm", "mm", "m", "un", "cl", "w", "v", "mah", "gb", "mb"]);

/** Cores compostas que levam hífen (a forma sem hífen vira a com hífen). */
export const CORES_COMPOSTAS = [
  "azul-marinho",
  "azul-claro",
  "azul-escuro",
  "azul-bebê",
  "verde-claro",
  "verde-escuro",
  "verde-água",
  "verde-musgo",
  "verde-bandeira",
  "cinza-claro",
  "cinza-escuro",
  "cinza-chumbo",
  "rosa-claro",
  "rosa-escuro",
  "rosa-bebê",
  "vermelho-escuro",
  "amarelo-claro",
  "off-white",
] as const;

export type MotivoDoNome =
  | "espaços"
  | "tamanho no nome"
  | "gênero"
  | "hífen"
  | "maiúsculas"
  | "caixa das letras"
  | "tamanho pelo código";

export type EntradaDoNome = {
  /** O nome como está no cadastro (`produto`). */
  nome: string;
  /** O código do cliente (`cod_cliente`), que termina no tamanho. */
  codigo?: string | null;
  /** O campo Gênero do cadastro ("Masculino", "Feminino", "Outros", "—"). */
  genero?: string | null;
  /** O campo Tamanho do cadastro. */
  tamanho?: string | null;
};

export type NomePadronizado = {
  /** O nome no padrão. */
  nome: string;
  /** O tamanho que o campo Tamanho deve ter; null quando nem o código nem o campo dizem. */
  tamanho: string | null;
  /** O que mudou, na ordem em que a regra aplica. Vazio quando nada mudou. */
  motivos: MotivoDoNome[];
  /** O que a regra não decide sozinha: uma pessoa confere antes de gravar. */
  conferir: string[];
};

const texto = (valor: unknown): string => String(valor ?? "").trim();

/**
 * O tamanho que o código do cliente carrega no fim: o último trecho depois do
 * ponto, de 1 a 4 letras ou números, quando o código tem três trechos ou
 * mais (A.01.0806.005.XG → XG, J.0149.003.N1 → N1). É a mesma regra do
 * agrupamento do portal (artifacts/app/src/lib/stock-variants.ts).
 */
export function sufixoDoCodigo(codigo: unknown): string | null {
  const partes = texto(codigo).split(".");
  if (partes.length < 3) return null;
  const ultimo = partes[partes.length - 1];
  return /^[A-Za-z0-9]{1,4}$/.test(ultimo) ? ultimo.toUpperCase() : null;
}

/** Um tamanho de roupa, N1…N9 ou um número de 1 a 69 (infantil e numeração). */
export function ehTamanho(token: unknown): boolean {
  const valor = texto(token).toUpperCase();
  return (TAMANHOS_DE_ROUPA as readonly string[]).includes(valor) || /^N[1-9]$/.test(valor) || /^(?:[1-9]|[1-6][0-9])$/.test(valor);
}

/** A posição na ordem natural: PP, P, M, G…; depois N1…; depois os números; o resto no fim. */
export function ordemDoTamanho(tamanho: unknown): number {
  const valor = texto(tamanho).toUpperCase();
  const indice = (TAMANHOS_DE_ROUPA as readonly string[]).indexOf(valor);
  if (indice !== -1) return indice;
  if (/^N[1-9]$/.test(valor)) return 100 + Number(valor.slice(1));
  if (/^\d+$/.test(valor)) return 200 + Number(valor);
  return 1000;
}

/** Espaços repetidos viram um; separador solto nas pontas sai ("POLO - " → "POLO"). */
export function limparEspacos(nome: string): string {
  return nome
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–.,;:]+/, "")
    .replace(/[\s\-–.,;:]+$/, "")
    .trim();
}

/**
 * Tira do fim do nome o tamanho que o código carrega ("… preto - XG" com
 * código …XG). Um tamanho no fim que não é o do código também sai, mas vira
 * "conferir"; sem tamanho no código, o nome fica como está e também vira
 * "conferir".
 */
export function tirarTamanhoDoFim(nome: string, sufixo: string | null): { nome: string; tirou: string | null; conferir: string | null } {
  const achado = /^(.*?)(?:\s*[-–]\s*|\s+)([A-Za-z0-9]{1,4})$/.exec(nome);
  if (!achado) return { nome, tirou: null, conferir: null };
  const [, antes, token] = achado;
  const maiusculo = token.toUpperCase();
  if (!antes.trim()) return { nome, tirou: null, conferir: null };
  // "Polo preto tam G" e "… tamanho G": a palavra sai junto com o tamanho.
  const semPalavra = antes.trim().replace(/[\s\-–]+(?:tam\.?|tamanho)$/iu, "").trim() || antes.trim();
  if (sufixo && maiusculo === sufixo) return { nome: semPalavra, tirou: token, conferir: null };
  if (!ehTamanho(maiusculo)) return { nome, tirou: null, conferir: null };
  if (!sufixo) return { nome, tirou: null, conferir: `tamanho no nome (${maiusculo}) e código sem tamanho` };
  return { nome: semPalavra, tirou: token, conferir: `tamanho no nome (${maiusculo}) diferente do código (${sufixo})` };
}

const MASCULINO = /\b(?:masculin[oa]s?|masc)\b\.?/giu;
const FEMININO = /\b(?:feminin[oa]s?|fem)\b\.?/giu;

/** A palavra do gênero vira a etiqueta: masculina, masc. → Masculino; feminino, fem. → Feminino. */
export function etiquetaDeGenero(nome: string): { nome: string; mudou: boolean } {
  let mudou = false;
  const trocar = (valor: string, etiqueta: string, padrao: RegExp) =>
    valor.replace(padrao, (palavra) => {
      if (palavra.toLocaleLowerCase("pt-BR") !== etiqueta.toLocaleLowerCase("pt-BR")) mudou = true;
      return etiqueta;
    });
  const resultado = trocar(trocar(nome, "Masculino", MASCULINO), "Feminino", FEMININO);
  return { nome: resultado, mudou };
}

/** O gênero que o nome diz; null sem a palavra ou com as duas. */
export function generoDoNome(nome: string): "Masculino" | "Feminino" | null {
  const masculino = new RegExp(MASCULINO.source, "iu").test(nome);
  const feminino = new RegExp(FEMININO.source, "iu").test(nome);
  if (masculino === feminino) return null;
  return masculino ? "Masculino" : "Feminino";
}

/** O campo Gênero lido com tolerância: "Masculino"/"Feminino", ou null para Outros, —, vazio. */
export function generoDoCampo(valor: unknown): "Masculino" | "Feminino" | null {
  const chave = texto(valor)
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (chave.startsWith("masc")) return "Masculino";
  if (chave.startsWith("fem")) return "Feminino";
  return null;
}

/** "azul marinho" → "azul-marinho", só para as cores da lista. */
export function hifenizarCores(nome: string): { nome: string; mudou: boolean } {
  let resultado = nome;
  for (const cor of CORES_COMPOSTAS) {
    const semHifen = cor.replace("-", " ");
    const padrao = new RegExp(`(?<!\\p{L})${semHifen.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\p{L})`, "giu");
    resultado = resultado.replace(padrao, cor);
  }
  return { nome: resultado, mudou: resultado !== nome };
}

function capitalizar(parte: string): string {
  const minusculo = parte.toLocaleLowerCase("pt-BR");
  const indice = minusculo.search(/\p{L}/u);
  if (indice === -1) return parte;
  return minusculo.slice(0, indice) + minusculo.charAt(indice).toLocaleUpperCase("pt-BR") + minusculo.slice(indice + 1);
}

/**
 * Inicial maiúscula em cada palavra. Conectivo em minúscula fora da primeira
 * palavra; sigla em maiúsculas; unidade depois de número em minúscula; palavra
 * com número fica como está; cada parte de uma palavra com hífen ou barra conta
 * como palavra.
 */
export function caixaDasLetras(nome: string): string {
  const palavras = nome.split(" ");
  return palavras
    .map((palavra, indice) => {
      if (!/\p{L}/u.test(palavra)) return palavra;
      if (/\d/.test(palavra)) return palavra;
      const anterior = indice > 0 ? palavras[indice - 1] : "";
      return palavra
        .split(/([-/])/)
        .map((parte) => {
          if (parte === "-" || parte === "/") return parte;
          const letras = parte.replace(/[^\p{L}]/gu, "");
          const minusculo = parte.toLocaleLowerCase("pt-BR");
          if (SIGLAS.has(letras.toUpperCase())) return parte.toUpperCase();
          if (indice > 0 && CONECTIVOS.has(minusculo)) return minusculo;
          if (UNIDADES.has(minusculo) && /^\d/.test(anterior)) return minusculo;
          return capitalizar(parte);
        })
        .join("");
    })
    .join(" ");
}

/**
 * O nome no padrão, o tamanho do campo e o que mudou. Não lança: nome vazio
 * volta vazio com "conferir".
 */
export function padronizarNome(entrada: EntradaDoNome): NomePadronizado {
  const original = texto(entrada.nome);
  const motivos: MotivoDoNome[] = [];
  const conferir: string[] = [];
  const trecho = sufixoDoCodigo(entrada.codigo);
  const sufixo = tamanhoDoCodigo(entrada.codigo);
  const campoTamanho = texto(entrada.tamanho);
  const campoMaiusculo = ehTamanho(campoTamanho) ? campoTamanho.toUpperCase() : campoTamanho;

  const tamanho = sufixo ?? (campoMaiusculo || null);
  if (sufixo && campoMaiusculo !== sufixo) {
    if (!campoTamanho || campoMaiusculo === sufixo) motivos.push("tamanho pelo código");
    else conferir.push(`campo Tamanho (${campoTamanho}) diferente do código (${sufixo})`);
  }
  if (sufixo && campoTamanho && campoMaiusculo === sufixo && campoTamanho !== sufixo) motivos.push("tamanho pelo código");
  if (!sufixo && campoTamanho && campoMaiusculo !== campoTamanho) motivos.push("tamanho pelo código");
  if (trecho && !sufixo) conferir.push(`tamanho do código (${trecho}) não é um tamanho conhecido`);

  if (!original) {
    conferir.push("nome vazio");
    return { nome: "", tamanho, motivos: ordenar(motivos), conferir };
  }

  let nome = limparEspacos(original);
  if (nome !== original) motivos.push("espaços");
  const letrasOriginais = nome.replace(/[^\p{L}]/gu, "");
  const todoMaiusculo = letrasOriginais.length > 0 && letrasOriginais === letrasOriginais.toLocaleUpperCase("pt-BR");
  if (sufixo && nome.toUpperCase() === sufixo) {
    conferir.push("nome é só o tamanho");
    return { nome, tamanho, motivos: ordenar(motivos), conferir };
  }

  // Sem tamanho no código, vale o do campo Tamanho, quando é um tamanho conhecido.
  const alvo = sufixo ?? (campoMaiusculo && ehTamanho(campoMaiusculo) ? campoMaiusculo : null);
  const semTamanho = tirarTamanhoDoFim(nome, alvo);
  if (semTamanho.tirou) motivos.push("tamanho no nome");
  if (semTamanho.conferir) conferir.push(sufixo ? semTamanho.conferir : semTamanho.conferir.replace("diferente do código", "diferente do campo Tamanho"));
  nome = semTamanho.nome;

  const comEtiqueta = etiquetaDeGenero(nome);
  if (comEtiqueta.mudou) motivos.push("gênero");
  nome = comEtiqueta.nome;

  const generoNoNome = generoDoNome(nome);
  const generoNoCampo = generoDoCampo(entrada.genero);
  if (generoNoNome && generoNoCampo && generoNoNome !== generoNoCampo) {
    conferir.push(`gênero do nome (${generoNoNome}) diferente do campo Gênero (${generoNoCampo})`);
  }

  const comHifen = hifenizarCores(nome);
  if (comHifen.mudou) motivos.push("hífen");
  nome = comHifen.nome;

  const comCaixa = caixaDasLetras(nome);
  if (comCaixa !== nome) motivos.push(todoMaiusculo ? "maiúsculas" : "caixa das letras");
  nome = comCaixa;

  return { nome, tamanho, motivos: ordenar(motivos), conferir };
}

const ORDEM_DOS_MOTIVOS: MotivoDoNome[] = ["espaços", "tamanho no nome", "gênero", "hífen", "maiúsculas", "caixa das letras", "tamanho pelo código"];

function ordenar(motivos: MotivoDoNome[]): MotivoDoNome[] {
  return ORDEM_DOS_MOTIVOS.filter((motivo) => motivos.includes(motivo));
}

/** O tamanho do código, quando o fim dele é um tamanho conhecido (A.01.0806.005.XG → XG; A.01.0806.005 → null). */
export function tamanhoDoCodigo(codigo: unknown): string | null {
  const sufixo = sufixoDoCodigo(codigo);
  return sufixo && ehTamanho(sufixo) ? sufixo : null;
}

/** O código sem o tamanho: a família (A.01.0806.005.XG → A.01.0806.005). Sem tamanho conhecido no fim, o código inteiro. */
export function familiaDoCodigo(codigo: unknown): string {
  const valor = texto(codigo);
  return tamanhoDoCodigo(valor) ? valor.slice(0, valor.lastIndexOf(".")) : valor;
}

/** O tamanho do produto: o do código, quando o fim dele é um tamanho conhecido; senão o campo Tamanho (em maiúsculas quando é um tamanho conhecido). */
export function tamanhoDoProduto(produto: { codigo?: unknown; tamanho?: unknown }): string | null {
  const doCodigo = tamanhoDoCodigo(produto.codigo);
  if (doCodigo) return doCodigo;
  const campo = texto(produto.tamanho);
  if (!campo) return null;
  return ehTamanho(campo) ? campo.toUpperCase() : campo;
}

/**
 * O nome sem o tamanho no fim, quando o fim é o tamanho do próprio produto
 * ("Polo preto - XG" com código …XG → "Polo preto"). Só tira o tamanho (e a
 * palavra "tam"/"tamanho" antes dele); não muda letras nem o resto do nome.
 */
export function nomeSemTamanho(produto: { nome: unknown; codigo?: unknown; tamanho?: unknown }): string {
  const nome = limparEspacos(texto(produto.nome));
  const tamanho = tamanhoDoProduto(produto);
  if (!nome || !tamanho) return nome;
  const resultado = tirarTamanhoDoFim(nome, tamanho.toUpperCase());
  return resultado.tirou && !resultado.conferir && resultado.nome ? resultado.nome : nome;
}

/**
 * "Polo Masculino Piquet Preto · XG": o nome sem o tamanho e o tamanho depois
 * do ponto, para as listas que mostram uma linha por tamanho. Tamanho único
 * (U) e produto sem tamanho ficam só com o nome.
 */
export function nomeComTamanho(produto: { nome: unknown; codigo?: unknown; tamanho?: unknown }): string {
  const nome = nomeSemTamanho(produto);
  const tamanho = tamanhoDoProduto(produto);
  if (!tamanho || tamanho.toUpperCase() === "U") return nome;
  return nome ? `${nome} · ${tamanho}` : tamanho;
}

export type TipoDeProblemaDoNome = "so_o_tamanho" | "tamanho_no_nome" | "nome_com_outro_tamanho" | "campo_com_outro_tamanho";

export type ProblemaDoNome = { tipo: TipoDeProblemaDoNome; mensagem: string };

/**
 * O que impede gravar o nome como está, com a frase que o cadastro mostra;
 * null quando pode. A caixa das letras, o gênero e os espaços o padrão corrige
 * sozinho e não são problema. Nome vazio também não: o formulário cobra o
 * campo obrigatório.
 *
 * - so_o_tamanho: o nome é só o tamanho.
 * - campo_com_outro_tamanho: o campo Tamanho diz um tamanho e o código, outro.
 * - nome_com_outro_tamanho: o nome termina num tamanho e o código é de outro.
 * - tamanho_no_nome: o nome termina no tamanho do próprio produto. As telas
 *   recusam; o backend tira o tamanho do nome (padronizarNome).
 */
export function problemaDoNome(produto: { nome: unknown; codigo?: unknown; tamanho?: unknown }): ProblemaDoNome | null {
  const nome = limparEspacos(texto(produto.nome));
  if (!nome) return null;
  const codigo = texto(produto.codigo);
  const doCodigo = tamanhoDoCodigo(codigo);
  const campo = texto(produto.tamanho);
  const tamanho = tamanhoDoProduto(produto);
  if (ehTamanho(nome) || (tamanho && nome.toUpperCase() === tamanho.toUpperCase())) {
    return { tipo: "so_o_tamanho", mensagem: "O nome do produto não pode ser só o tamanho." };
  }
  if (doCodigo && campo && campo.toUpperCase() !== doCodigo) {
    return { tipo: "campo_com_outro_tamanho", mensagem: `O código ${codigo} é do tamanho ${doCodigo}, e o Tamanho informado é ${campo}.` };
  }
  const achado = /^(.*?)(?:\s*[-–]\s*|\s+)([A-Za-z0-9]{1,4})$/.exec(nome);
  if (!achado || !achado[1].trim()) return null;
  const fim = achado[2].toUpperCase();
  if (!ehTamanho(fim)) return null;
  if (tamanho && fim === tamanho.toUpperCase()) {
    const familia = doCodigo ? ` O nome é o mesmo em todos os tamanhos de ${familiaDoCodigo(codigo)}.` : "";
    return { tipo: "tamanho_no_nome", mensagem: `O tamanho ${fim} fica no campo Tamanho.${familia}` };
  }
  if (doCodigo) {
    return { tipo: "nome_com_outro_tamanho", mensagem: `O nome termina em ${fim}, e o código ${codigo} é do tamanho ${doCodigo}.` };
  }
  if (tamanho) {
    return { tipo: "nome_com_outro_tamanho", mensagem: `O nome termina em ${fim}, e o Tamanho informado é ${tamanho}.` };
  }
  return null;
}
