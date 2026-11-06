/**
 * O padrão do nome do produto: cópia em JavaScript de
 * lib/dominio/src/nome-do-produto.ts (a ferramenta roda em Node puro, sem
 * TypeScript). Mudou um, muda o outro: regras.test.mjs roda os mesmos casos de
 * lib/dominio/src/nome-do-produto.casos.json que o vitest do app roda contra o
 * original. As decisões estão no cabeçalho do original.
 */

/** Os tamanhos de roupa na ordem natural; N1… e os números vêm depois. */
export const TAMANHOS_DE_ROUPA = ["PP", "P", "M", "G", "GG", "XG", "XGG", "EG", "EGG", "U"];

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
];

const texto = (valor) => String(valor ?? "").trim();

/**
 * O tamanho que o código do cliente carrega no fim: o último trecho depois do
 * ponto, de 1 a 4 letras ou números, quando o código tem três trechos ou
 * mais (A.01.0806.005.XG → XG, J.0149.003.N1 → N1).
 */
export function sufixoDoCodigo(codigo) {
  const partes = texto(codigo).split(".");
  if (partes.length < 3) return null;
  const ultimo = partes[partes.length - 1];
  return /^[A-Za-z0-9]{1,4}$/.test(ultimo) ? ultimo.toUpperCase() : null;
}

/** Um tamanho de roupa, N1…N9 ou um número de dois dígitos (20 a 69). */
export function ehTamanho(token) {
  const valor = texto(token).toUpperCase();
  return TAMANHOS_DE_ROUPA.includes(valor) || /^N[1-9]$/.test(valor) || /^[2-6][0-9]$/.test(valor);
}

/** A posição na ordem natural: PP, P, M, G…; depois N1…; depois os números; o resto no fim. */
export function ordemDoTamanho(tamanho) {
  const valor = texto(tamanho).toUpperCase();
  const indice = TAMANHOS_DE_ROUPA.indexOf(valor);
  if (indice !== -1) return indice;
  if (/^N[1-9]$/.test(valor)) return 100 + Number(valor.slice(1));
  if (/^\d+$/.test(valor)) return 200 + Number(valor);
  return 1000;
}

/** Espaços repetidos viram um; separador solto nas pontas sai ("POLO - " → "POLO"). */
export function limparEspacos(nome) {
  return nome
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–.,;:]+/, "")
    .replace(/[\s\-–.,;:]+$/, "")
    .trim();
}

/**
 * Tira do fim do nome o tamanho que o código carrega. Um tamanho no fim que
 * não é o do código também sai, mas vira "conferir"; sem tamanho no código, o
 * nome fica como está e também vira "conferir".
 */
export function tirarTamanhoDoFim(nome, sufixo) {
  const achado = /^(.*?)(?:\s*[-–]\s*|\s+)([A-Za-z0-9]{1,4})$/.exec(nome);
  if (!achado) return { nome, tirou: null, conferir: null };
  const [, antes, token] = achado;
  const maiusculo = token.toUpperCase();
  if (!antes.trim()) return { nome, tirou: null, conferir: null };
  if (sufixo && maiusculo === sufixo) return { nome: antes.trim(), tirou: token, conferir: null };
  if (!ehTamanho(maiusculo)) return { nome, tirou: null, conferir: null };
  if (!sufixo) return { nome, tirou: null, conferir: `tamanho no nome (${maiusculo}) e código sem tamanho` };
  return { nome: antes.trim(), tirou: token, conferir: `tamanho no nome (${maiusculo}) diferente do código (${sufixo})` };
}

const MASCULINO = /\b(?:masculin[oa]s?|masc)\b\.?/giu;
const FEMININO = /\b(?:feminin[oa]s?|fem)\b\.?/giu;

/** A palavra do gênero vira a etiqueta: masculina, masc. → Masculino; feminino, fem. → Feminino. */
export function etiquetaDeGenero(nome) {
  let mudou = false;
  const trocar = (valor, etiqueta, padrao) =>
    valor.replace(padrao, (palavra) => {
      if (palavra.toLocaleLowerCase("pt-BR") !== etiqueta.toLocaleLowerCase("pt-BR")) mudou = true;
      return etiqueta;
    });
  const resultado = trocar(trocar(nome, "Masculino", MASCULINO), "Feminino", FEMININO);
  return { nome: resultado, mudou };
}

/** O gênero que o nome diz; null sem a palavra ou com as duas. */
export function generoDoNome(nome) {
  const masculino = new RegExp(MASCULINO.source, "iu").test(nome);
  const feminino = new RegExp(FEMININO.source, "iu").test(nome);
  if (masculino === feminino) return null;
  return masculino ? "Masculino" : "Feminino";
}

/** O campo Gênero lido com tolerância: "Masculino"/"Feminino", ou null para Outros, —, vazio. */
export function generoDoCampo(valor) {
  const chave = texto(valor)
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (chave.startsWith("masc")) return "Masculino";
  if (chave.startsWith("fem")) return "Feminino";
  return null;
}

/** "azul marinho" → "azul-marinho", só para as cores da lista. */
export function hifenizarCores(nome) {
  let resultado = nome;
  for (const cor of CORES_COMPOSTAS) {
    const semHifen = cor.replace("-", " ");
    const padrao = new RegExp(`\\b${semHifen.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "giu");
    resultado = resultado.replace(padrao, cor);
  }
  return { nome: resultado, mudou: resultado !== nome };
}

function capitalizar(parte) {
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
export function caixaDasLetras(nome) {
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
export function padronizarNome(entrada) {
  const original = texto(entrada.nome);
  const motivos = [];
  const conferir = [];
  const sufixo = sufixoDoCodigo(entrada.codigo);
  const campoTamanho = texto(entrada.tamanho);

  const tamanho = sufixo ?? (campoTamanho || null);
  if (sufixo && !campoTamanho) motivos.push("tamanho pelo código");
  if (sufixo && campoTamanho && campoTamanho.toUpperCase() !== sufixo) conferir.push(`campo Tamanho (${campoTamanho}) diferente do código (${sufixo})`);

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

  const semTamanho = tirarTamanhoDoFim(nome, sufixo);
  if (semTamanho.tirou) motivos.push("tamanho no nome");
  if (semTamanho.conferir) conferir.push(semTamanho.conferir);
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

const ORDEM_DOS_MOTIVOS = ["espaços", "tamanho no nome", "gênero", "hífen", "maiúsculas", "caixa das letras", "tamanho pelo código"];

function ordenar(motivos) {
  return ORDEM_DOS_MOTIVOS.filter((motivo) => motivos.includes(motivo));
}

/** O código sem o tamanho: a família (A.01.0806.005.XG → A.01.0806.005). Sem tamanho, o código inteiro. */
export function familiaDoCodigo(codigo) {
  const valor = texto(codigo);
  return sufixoDoCodigo(valor) ? valor.slice(0, valor.lastIndexOf(".")) : valor;
}
