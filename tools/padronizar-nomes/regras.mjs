// Gerado de lib/dominio/src/nome-do-produto.ts por tools/padronizar-nomes/gerar-regras.mjs: não edite aqui.
// O vitest do app reprova quando este arquivo não é o que o gerador produz.
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
 *    minúscula; siglas (BTG) em maiúsculas; unidade depois de número na forma
 *    de sempre ("500 ml", "2 L", "20 W"); cores compostas com hífen
 *    ("Azul-Marinho").
 * 4. Nada além disso: a regra não reordena palavras, não acrescenta cor nem
 *    corrige digitação. O que ela não resolve sozinha vira "conferir".
 *
 * Funções puras, sem Firestore. Cópias: functions/wms/src/domain/nome-do-produto.ts
 * (literal, travada em nome-do-produto.test.ts de lá) e
 * tools/padronizar-nomes/regras.mjs (gerada deste arquivo por
 * gerar-regras.mjs, travada no vitest do app). As três rodam os mesmos casos
 * de nome-do-produto.casos.json.
 */
/** Os tamanhos de roupa na ordem natural; N1… e os números vêm depois. */
export const TAMANHOS_DE_ROUPA = ["PP", "P", "M", "G", "GG", "XG", "XGG", "XXG", "XXXG", "EG", "EGG", "EXG", "XS", "S", "L", "XL", "XXL", "U"];
/**
 * Siglas com vogal que ficam em maiúsculas no nome. A palavra de 2 a 5 letras
 * sem vogal já é sigla e não precisa estar aqui (a sigla do cliente, TNT, MDF,
 * ML de manga longa): a lista não cita cliente nenhum.
 */
export const SIGLAS = new Set([
    "SW",
    "UV",
    "UVA",
    "UVB",
    "LED",
    "USB",
    "PVC",
    "PET",
    "GPS",
    "TV",
    "PC",
    "SP",
    "RJ",
    "MG",
    "DF",
    "BR",
    "ML",
    "MC",
    "AA",
    "AAA",
    "TNT",
    "MDF",
    "HDMI",
    "VGA",
    "PU",
    "EVA",
    "EPI",
    "LCD",
    "SSD",
    "QR",
    "NF",
]);
/** Conectivos em minúscula, menos na primeira e na última palavra ("Vitamina A"). */
export const CONECTIVOS = new Set([
    "de",
    "da",
    "do",
    "das",
    "dos",
    "e",
    "em",
    "com",
    "sem",
    "para",
    "a",
    "o",
    "ao",
    "aos",
    "à",
    "às",
    "na",
    "no",
    "nas",
    "nos",
    "por",
    "pelo",
    "pela",
    "pelos",
    "pelas",
    "ou",
]);
/** A unidade depois de um número, na forma de sempre: "500 ML" → "500 ml", "20 w" → "20 W", "32GB" → "32 GB". */
export const UNIDADES = new Map([
    ["ml", "ml"],
    ["cl", "cl"],
    ["l", "L"],
    ["mg", "mg"],
    ["g", "g"],
    ["kg", "kg"],
    ["mm", "mm"],
    ["cm", "cm"],
    ["m", "m"],
    ["un", "un"],
    ["w", "W"],
    ["v", "V"],
    ["mah", "mAh"],
    ["mb", "MB"],
    ["gb", "GB"],
    ["tb", "TB"],
]);
/** Cores compostas que levam hífen. A forma sem hífen ganha o hífen; as letras e os acentos ficam como vieram. */
export const CORES_COMPOSTAS = [
    "azul-marinho",
    "azul-claro",
    "azul-escuro",
    "azul-bebê",
    "azul-royal",
    "azul-turquesa",
    "azul-petróleo",
    "verde-claro",
    "verde-escuro",
    "verde-água",
    "verde-musgo",
    "verde-bandeira",
    "verde-oliva",
    "verde-limão",
    "cinza-claro",
    "cinza-escuro",
    "cinza-chumbo",
    "rosa-claro",
    "rosa-escuro",
    "rosa-bebê",
    "vermelho-escuro",
    "amarelo-claro",
    "amarelo-ouro",
    "off-white",
];
/** Palavras que vêm antes de uma letra que faz parte do nome, não do tamanho: "Gola U", "Tipo C", "Vitamina A". */
const ANTES_DE_LETRA_DO_NOME = new Set(["gola", "decote", "tipo", "modelo", "formato", "perfil", "vitamina", "classe", "plano", "série", "serie", "letra", "linha"]);
const texto = (valor) => String(valor ?? "").trim();
const NUMERO = /^\d+(?:[.,]\d+)?$/;
/**
 * O último trecho do código depois do ponto, de 1 a 4 letras ou números,
 * quando o código tem três trechos ou mais (A.01.0806.005.XG → XG). É a regra
 * do agrupamento do portal (artifacts/app/src/lib/stock-variants.ts); para
 * saber se é um tamanho, `tamanhoDoCodigo`.
 */
export function sufixoDoCodigo(codigo) {
    const partes = texto(codigo).replace(/\.+$/, "").split(".");
    if (partes.length < 3)
        return null;
    const ultimo = partes[partes.length - 1];
    return /^[A-Za-z0-9]{1,4}$/.test(ultimo) ? ultimo.toUpperCase() : null;
}
/** Um tamanho de roupa, N1…N99 ou um número de 1 a 69 (infantil e numeração). */
export function ehTamanho(token) {
    const valor = texto(token).toUpperCase();
    return TAMANHOS_DE_ROUPA.includes(valor) || /^N[1-9]\d?$/.test(valor) || /^(?:[1-9]|[1-6][0-9])$/.test(valor);
}
/** O tamanho do código, quando o fim dele é um tamanho conhecido (A.01.0806.005.XG → XG; A.01.0806.005 → null). */
export function tamanhoDoCodigo(codigo) {
    const sufixo = sufixoDoCodigo(codigo);
    return sufixo && ehTamanho(sufixo) ? sufixo : null;
}
/** O código sem o tamanho: a família (A.01.0806.005.XG → A.01.0806.005). Sem tamanho conhecido no fim, o código inteiro. */
export function familiaDoCodigo(codigo) {
    const valor = texto(codigo).replace(/\.+$/, "");
    return tamanhoDoCodigo(valor) ? valor.slice(0, valor.lastIndexOf(".")) : valor;
}
/** A posição na ordem natural: PP, P, M, G…; depois N1…; depois os números; o resto no fim. */
export function ordemDoTamanho(tamanho) {
    const valor = texto(tamanho).toUpperCase();
    const indice = TAMANHOS_DE_ROUPA.indexOf(valor);
    if (indice !== -1)
        return indice;
    if (/^N\d+$/.test(valor))
        return 100 + Number(valor.slice(1));
    if (/^\d+$/.test(valor))
        return 200 + Number(valor);
    return 1000;
}
/** Espaços repetidos viram um; separador solto nas pontas sai ("POLO - " → "POLO"). */
export function limparEspacos(nome) {
    return nome
        .replace(/\s+/g, " ")
        .replace(/^[\s\-–—.,;:]+/, "")
        .replace(/[\s\-–—.,;:]+$/, "")
        .trim();
}
const SEPARADO_NO_FIM = /^(.*?)(?:\s*[-–—/]\s*|\s+)([A-Za-z0-9]{1,4})$/u;
const ENTRE_PARENTESES_NO_FIM = /^(.*?)\s*[([]\s*([A-Za-z0-9]{1,4})\s*[)\]]$/u;
/**
 * O tamanho no fim do nome e o que vem antes dele; null quando o fim não é um
 * tamanho. Fica no nome a medida ("500 G", "1 M"), a letra que faz parte dele
 * ("Gola U", "Tipo C"), o "U" de quem não é tamanho único e o número de quem
 * não tem tamanho numérico ("Caderno 2").
 */
function tamanhoNoFim(nome, alvo) {
    const achado = ENTRE_PARENTESES_NO_FIM.exec(nome) ?? SEPARADO_NO_FIM.exec(nome);
    if (!achado)
        return null;
    const antes = achado[1].trim();
    const tamanho = achado[2].toUpperCase();
    if (!antes || !ehTamanho(tamanho))
        return null;
    if (tamanho === "U" && alvo !== "U")
        return null;
    // Número no fim só é tamanho quando o do produto também é ("Calça 42"); "Caderno 2", "Modelo 3" e "Copo 50" são nome.
    if (/^\d+$/.test(tamanho) && !(alvo && /^\d+$/.test(alvo)))
        return null;
    const palavras = antes.split(" ");
    const anterior = (palavras[palavras.length - 1] ?? "").toLocaleLowerCase("pt-BR");
    if (NUMERO.test(anterior) || ANTES_DE_LETRA_DO_NOME.has(anterior))
        return null;
    return { antes, tamanho };
}
/** O que sobra antes do tamanho, sem pontuação solta e sem a palavra "tam"/"tamanho" ("Preto, Tam.:" → "Preto"). */
function semRotuloDeTamanho(antes) {
    const limpo = limparEspacos(antes);
    const semRotulo = limparEspacos(limpo.replace(/(?:^|[\s\-–—])(?:tam|tamanho)$/iu, ""));
    return semRotulo || limpo;
}
/**
 * Tira do fim do nome o tamanho `sufixo` ("… preto - XG" com XG). Um tamanho
 * no fim que não é o `sufixo` também sai, mas vira "conferir"; sem `sufixo`, o
 * nome fica como está e também vira "conferir".
 */
export function tirarTamanhoDoFim(nome, sufixo) {
    const fim = tamanhoNoFim(nome, sufixo);
    if (!fim)
        return { nome, tirou: null, conferir: null };
    if (!sufixo)
        return { nome, tirou: null, conferir: `tamanho no nome (${fim.tamanho}) e código sem tamanho` };
    const antes = semRotuloDeTamanho(fim.antes);
    if (fim.tamanho === sufixo)
        return { nome: antes, tirou: fim.tamanho, conferir: null };
    return { nome: antes, tirou: fim.tamanho, conferir: `tamanho no nome (${fim.tamanho}) diferente do código (${sufixo})` };
}
const SEM_LETRA_ANTES = "(?<![\\p{L}\\p{N}])";
const SEM_LETRA_DEPOIS = "(?![\\p{L}\\p{N}])";
const MASCULINO = new RegExp(`${SEM_LETRA_ANTES}(?:masculin[oa]s?|masc)${SEM_LETRA_DEPOIS}(?:\\.(?=\\s|$))?`, "giu");
const FEMININO = new RegExp(`${SEM_LETRA_ANTES}(?:feminin[oa]s?|fem)${SEM_LETRA_DEPOIS}(?:\\.(?=\\s|$))?`, "giu");
const ABREVIACAO_COLADA = new RegExp(`${SEM_LETRA_ANTES}(masculin[oa]s?|masc|feminin[oa]s?|fem)\\.(?=\\p{L})`, "giu");
/** A palavra do gênero vira a etiqueta: masculina, masc. → Masculino; feminino, fem. → Feminino. */
export function etiquetaDeGenero(nome) {
    let mudou = false;
    const trocar = (valor, etiqueta, padrao) => valor.replace(padrao, (palavra) => {
        if (palavra.toLocaleLowerCase("pt-BR") !== etiqueta.toLocaleLowerCase("pt-BR"))
            mudou = true;
        return etiqueta;
    });
    const separado = nome.replace(ABREVIACAO_COLADA, "$1. ");
    const resultado = trocar(trocar(separado, "Masculino", MASCULINO), "Feminino", FEMININO);
    return { nome: resultado, mudou: mudou || separado !== nome };
}
/** O gênero que o nome diz; null sem a palavra ou com as duas. */
export function generoDoNome(nome) {
    const masculino = new RegExp(MASCULINO.source, "iu").test(nome);
    const feminino = new RegExp(FEMININO.source, "iu").test(nome);
    if (masculino === feminino)
        return null;
    return masculino ? "Masculino" : "Feminino";
}
/** O campo Gênero lido com tolerância: "Masculino"/"Feminino", ou null para Outros, —, vazio. */
export function generoDoCampo(valor) {
    const chave = texto(valor)
        .toLocaleLowerCase("pt-BR")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
    if (chave.startsWith("masc"))
        return "Masculino";
    if (chave.startsWith("fem"))
        return "Feminino";
    return null;
}
const VOGAIS_COM_ACENTO = { a: "aáàâãä", e: "eéèêë", i: "iíìîï", o: "oóòôõö", u: "uúùûü", c: "cç" };
/** A palavra com e sem acento, para a cor digitada sem acento também ganhar o hífen. */
function comOuSemAcento(palavra) {
    return [...palavra.normalize("NFD").replace(/[̀-ͯ]/g, "")]
        .map((letra) => (VOGAIS_COM_ACENTO[letra] ? `[${VOGAIS_COM_ACENTO[letra]}]` : letra.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
        .join("");
}
/** "azul marinho" → "azul-marinho", só para as cores da lista; troca só o espaço pelo hífen. */
export function hifenizarCores(nome) {
    let resultado = nome;
    for (const cor of CORES_COMPOSTAS) {
        const [primeira, segunda] = cor.split("-");
        const padrao = new RegExp(`${SEM_LETRA_ANTES}(${comOuSemAcento(primeira)})\\s+(${comOuSemAcento(segunda)})${SEM_LETRA_DEPOIS}`, "giu");
        resultado = resultado.replace(padrao, "$1-$2");
    }
    return { nome: resultado, mudou: resultado !== nome };
}
/** Palavra de 2 a 5 letras sem vogal: sigla ("TNT", "MDF", "ML"). */
function ehSiglaSemVogal(letras) {
    return /^\p{L}{2,5}$/u.test(letras) && !/[aeiouyáàâãäéèêëíìîïóòôõöúùûü]/iu.test(letras);
}
function capitalizar(parte) {
    const minusculo = parte.toLocaleLowerCase("pt-BR");
    const indice = minusculo.search(/\p{L}/u);
    if (indice === -1)
        return parte;
    return minusculo.slice(0, indice) + minusculo.charAt(indice).toLocaleUpperCase("pt-BR") + minusculo.slice(indice + 1);
}
/**
 * Inicial maiúscula em cada palavra. Conectivo em minúscula fora da primeira e
 * da última palavra; sigla em maiúsculas; unidade depois de número na forma de
 * sempre, e a colada ao número ganha o espaço ("500ML" → "500 ml"); o "x" de
 * medida entre números fica minúsculo ("70 x 140"); "c/", "p/" e "s/" ficam
 * minúsculos; outra palavra com número fica como está; cada parte de uma
 * palavra com hífen, barra ou apóstrofo conta como palavra ("D'Água").
 */
export function caixaDasLetras(nome) {
    const palavras = nome.split(" ");
    const ultima = palavras.length - 1;
    return palavras
        .map((palavra, indice) => {
        if (!/\p{L}/u.test(palavra))
            return palavra;
        const anterior = indice > 0 ? palavras[indice - 1] : "";
        const seguinte = indice < ultima ? palavras[indice + 1] : "";
        const minusculo = palavra.toLocaleLowerCase("pt-BR");
        if (minusculo === "x" && /^\d/.test(anterior) && /^\d/.test(seguinte))
            return "x";
        const colada = /^(\d+(?:[.,]\d+)?)(\p{L}+)$/u.exec(palavra);
        if (colada) {
            const unidade = UNIDADES.get(colada[2].toLocaleLowerCase("pt-BR"));
            return unidade ? `${colada[1]} ${unidade}` : palavra;
        }
        if (/\d/.test(palavra))
            return palavra;
        const unidade = UNIDADES.get(minusculo);
        if (unidade && NUMERO.test(anterior))
            return unidade;
        if (indice > 0 && indice < ultima && CONECTIVOS.has(minusculo))
            return minusculo;
        if (/^[cps]\/$/.test(minusculo))
            return minusculo;
        return palavra
            .split(/([-/'’])/)
            .map((parte) => {
            if (/^[-/'’]$/.test(parte))
                return parte;
            const letras = parte.replace(/[^\p{L}]/gu, "");
            if (SIGLAS.has(letras.toUpperCase()) || ehSiglaSemVogal(letras))
                return parte.toUpperCase();
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
    const trecho = sufixoDoCodigo(entrada.codigo);
    const sufixo = tamanhoDoCodigo(entrada.codigo);
    const campoTamanho = texto(entrada.tamanho);
    const campoMaiusculo = ehTamanho(campoTamanho) ? campoTamanho.toUpperCase() : campoTamanho;
    const tamanho = sufixo ?? (campoMaiusculo || null);
    if (sufixo && campoMaiusculo !== sufixo) {
        if (!campoTamanho || campoMaiusculo === sufixo)
            motivos.push("tamanho pelo código");
        else
            conferir.push(`campo Tamanho (${campoTamanho}) diferente do código (${sufixo})`);
    }
    if (sufixo && campoTamanho && campoMaiusculo === sufixo && campoTamanho !== sufixo)
        motivos.push("tamanho pelo código");
    if (!sufixo && campoTamanho && campoMaiusculo !== campoTamanho)
        motivos.push("tamanho pelo código");
    if (trecho && !sufixo)
        conferir.push(`tamanho do código (${trecho}) não é um tamanho conhecido`);
    let nome = limparEspacos(original);
    if (nome !== original)
        motivos.push("espaços");
    if (!nome) {
        conferir.push("nome vazio");
        return { nome: "", tamanho, motivos: ordenar(motivos), conferir };
    }
    // Sem tamanho no código, vale o do campo Tamanho, quando é um tamanho conhecido.
    const alvo = sufixo ?? (campoMaiusculo && ehTamanho(campoMaiusculo) ? campoMaiusculo : null);
    if (ehTamanho(nome) || (alvo && nome.toUpperCase() === alvo)) {
        conferir.push("nome é só o tamanho");
        return { nome, tamanho, motivos: ordenar(motivos), conferir };
    }
    // O tamanho repetido no fim ("M M") sai todo; um tamanho que não é o do produto sai e vira conferir.
    let tirou = false;
    for (let volta = 0; volta < 3; volta += 1) {
        const semTamanho = tirarTamanhoDoFim(nome, alvo);
        if (semTamanho.conferir) {
            conferir.push(sufixo ? semTamanho.conferir : semTamanho.conferir.replace("diferente do código", "diferente do campo Tamanho"));
        }
        if (!semTamanho.tirou)
            break;
        nome = semTamanho.nome;
        tirou = true;
        if (semTamanho.conferir)
            break;
    }
    if (tirou)
        motivos.push("tamanho no nome");
    const comEtiqueta = etiquetaDeGenero(nome);
    if (comEtiqueta.mudou)
        motivos.push("gênero");
    nome = comEtiqueta.nome;
    const generoNoNome = generoDoNome(nome);
    const generoNoCampo = generoDoCampo(entrada.genero);
    if (generoNoNome && generoNoCampo && generoNoNome !== generoNoCampo) {
        conferir.push(`gênero do nome (${generoNoNome}) diferente do campo Gênero (${generoNoCampo})`);
    }
    const comHifen = hifenizarCores(nome);
    if (comHifen.mudou)
        motivos.push("hífen");
    nome = comHifen.nome;
    const letrasOriginais = original.replace(/[^\p{L}]/gu, "");
    const todoMaiusculo = letrasOriginais.length > 0 && letrasOriginais === letrasOriginais.toLocaleUpperCase("pt-BR");
    const comCaixa = caixaDasLetras(nome);
    if (comCaixa !== nome)
        motivos.push(todoMaiusculo ? "maiúsculas" : "caixa das letras");
    nome = comCaixa;
    return { nome, tamanho, motivos: ordenar(motivos), conferir };
}
const ORDEM_DOS_MOTIVOS = ["espaços", "tamanho no nome", "gênero", "hífen", "maiúsculas", "caixa das letras", "tamanho pelo código"];
function ordenar(motivos) {
    return ORDEM_DOS_MOTIVOS.filter((motivo) => motivos.includes(motivo));
}
/** O tamanho do produto: o do código, quando o fim dele é um tamanho conhecido; senão o campo Tamanho (em maiúsculas quando é um tamanho conhecido). */
export function tamanhoDoProduto(produto) {
    const doCodigo = tamanhoDoCodigo(produto.codigo);
    if (doCodigo)
        return doCodigo;
    const campo = texto(produto.tamanho);
    if (!campo)
        return null;
    return ehTamanho(campo) ? campo.toUpperCase() : campo;
}
/**
 * O nome sem o tamanho no fim, quando o fim é o tamanho do próprio produto
 * ("Polo preto - XG" com código …XG → "Polo preto"). Só tira o tamanho (e a
 * palavra "tam"/"tamanho" antes dele); não muda letras nem o resto do nome.
 */
export function nomeSemTamanho(produto) {
    const nome = limparEspacos(texto(produto.nome));
    const tamanho = tamanhoDoProduto(produto);
    if (!nome || !tamanho)
        return nome;
    const resultado = tirarTamanhoDoFim(nome, tamanho.toUpperCase());
    return resultado.tirou && !resultado.conferir && resultado.nome ? resultado.nome : nome;
}
/**
 * "Polo Masculino Piquet Preto · XG": o nome sem o tamanho e o tamanho depois
 * do ponto, para as listas que mostram uma linha por tamanho. Tamanho único
 * (U) e produto sem tamanho ficam só com o nome.
 */
export function nomeComTamanho(produto) {
    const nome = nomeSemTamanho(produto);
    const tamanho = tamanhoDoProduto(produto);
    if (!tamanho || tamanho.toUpperCase() === "U")
        return nome;
    return nome ? `${nome} · ${tamanho}` : tamanho;
}
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
export function problemaDoNome(produto) {
    const nome = limparEspacos(texto(produto.nome));
    if (!nome)
        return null;
    const codigo = texto(produto.codigo);
    const doCodigo = tamanhoDoCodigo(codigo);
    const campo = texto(produto.tamanho);
    const tamanho = tamanhoDoProduto(produto);
    const alvo = tamanho && ehTamanho(tamanho) ? tamanho.toUpperCase() : null;
    if (ehTamanho(nome) || (alvo && nome.toUpperCase() === alvo)) {
        return { tipo: "so_o_tamanho", mensagem: "O nome do produto não pode ser só o tamanho." };
    }
    if (doCodigo && campo && campo.toUpperCase() !== doCodigo) {
        return { tipo: "campo_com_outro_tamanho", mensagem: `O código ${codigo} é do tamanho ${doCodigo}, e o Tamanho informado é ${campo}.` };
    }
    const fim = tamanhoNoFim(nome, alvo);
    if (!fim)
        return null;
    if (alvo && fim.tamanho === alvo) {
        const familia = doCodigo ? ` O nome é o mesmo em todos os tamanhos de ${familiaDoCodigo(codigo)}.` : "";
        return { tipo: "tamanho_no_nome", mensagem: `O tamanho ${fim.tamanho} fica no campo Tamanho.${familia}` };
    }
    if (doCodigo) {
        return { tipo: "nome_com_outro_tamanho", mensagem: `O nome termina em ${fim.tamanho}, e o código ${codigo} é do tamanho ${doCodigo}.` };
    }
    if (alvo) {
        return { tipo: "nome_com_outro_tamanho", mensagem: `O nome termina em ${fim.tamanho}, e o Tamanho informado é ${alvo}.` };
    }
    return null;
}
