// Gerado de lib/dominio/src/saldo-da-caixa.ts por tools/corrigir-codigo-do-produto/gerar-saldo-da-caixa.mjs: não edite aqui.
// O vitest do app reprova quando este arquivo não é o que o gerador produz.
/**
 * O saldo da caixa (docs/plataforma/separacao-com-caixas.md, seção 4.3,
 * parte 3, e a contagem por caixa, docs/plataforma/diagnostico-contagem-
 * ciclica.md, seção 6, item 4). O conteúdo de entrada da caixa não muda: o
 * que cada separação tira fica gravado na própria caixa (`taken_lines`), o
 * que cada recontagem acerta também (`count_adjustments`, com o id da
 * contagem), e o saldo é a entrada menos o retirado mais os ajustes. A linha
 * do pedido sai da caixa mais antiga da prateleira que tem o item; se ela
 * não basta, a seguinte completa; o que as caixas não cobrem sai sem caixa.
 *
 * Funções puras, sem Firestore. Cópias: functions/wms/src/domain/
 * saldo-da-caixa.ts (literal, travada em saldo-da-caixa.test.ts de lá) e
 * tools/corrigir-codigo-do-produto/saldo-da-caixa.mjs (gerada deste arquivo
 * por gerar-saldo-da-caixa.mjs, travada no vitest do app), a das ferramentas
 * do acerto. As três rodam os mesmos casos de saldo-da-caixa.casos.json.
 */
function codigo(value) {
    return typeof value === "string" ? value.trim() : "";
}
function quantidade(value) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
/** O ajuste tem sinal: só o que não é número fica de fora. */
function comSinal(value) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}
function porSku(linhas) {
    const soma = new Map();
    for (const linha of linhas) {
        const sku = codigo(linha.sku_code);
        const qty = quantidade(linha.qty);
        if (!sku || !qty)
            continue;
        soma.set(sku, (soma.get(sku) ?? 0) + qty);
    }
    return soma;
}
/** Os ajustes somados por SKU, com o sinal, na ordem em que cada SKU apareceu. */
function ajustesPorSku(ajustes) {
    const soma = new Map();
    for (const ajuste of ajustes) {
        const sku = codigo(ajuste.sku_code);
        const qty = comSinal(ajuste.qty);
        if (!sku || !qty)
            continue;
        soma.set(sku, (soma.get(sku) ?? 0) + qty);
    }
    return soma;
}
/**
 * A entrada menos o retirado mais os ajustes da recontagem, por SKU: nunca
 * negativo, sem as linhas zeradas, na ordem da entrada; o SKU que só a
 * recontagem pôs na caixa vem depois, na ordem dos ajustes.
 */
export function saldoDaCaixa(entrada, retirado, ajustes = []) {
    const entrou = porSku(entrada);
    const saiu = porSku(retirado);
    const ajustou = ajustesPorSku(ajustes);
    const saldo = [];
    for (const [sku_code, qty] of entrou) {
        const resta = qty - (saiu.get(sku_code) ?? 0) + (ajustou.get(sku_code) ?? 0);
        if (resta > 0)
            saldo.push({ sku_code, qty: resta });
    }
    for (const [sku_code, qty] of ajustou) {
        if (entrou.has(sku_code))
            continue;
        const resta = qty - (saiu.get(sku_code) ?? 0);
        if (resta > 0)
            saldo.push({ sku_code, qty: resta });
    }
    return saldo;
}
/** O que as recontagens puseram (positivo) ou tiraram (negativo) da caixa, somado. */
export function unidadesAjustadas(ajustes) {
    let soma = 0;
    for (const qty of ajustesPorSku(ajustes).values())
        soma += qty;
    return soma;
}
/**
 * O ajuste que deixa um SKU da caixa com o contado: o contado menos a conta
 * de hoje (entrada menos retirado mais os ajustes anteriores), sem o piso do
 * saldo. Assim a conta fecha no contado mesmo quando o retirado passou da
 * entrada (a entrada corrigida depois da separação).
 */
export function ajusteParaOContado(entrada, retirado, ajustes, sku_code, contado) {
    const sku = codigo(sku_code);
    if (!sku)
        return 0;
    const conta = (porSku(entrada).get(sku) ?? 0) - (porSku(retirado).get(sku) ?? 0) + (ajustesPorSku(ajustes).get(sku) ?? 0);
    return quantidade(contado) - conta;
}
/** As unidades de um conteúdo: a soma das linhas. */
export function unidadesDaCaixa(linhas) {
    let soma = 0;
    for (const qty of porSku(linhas).values())
        soma += qty;
    return soma;
}
/** O retirado depois de somar (ou, com `qty` negativo, devolver) um SKU: sem as linhas zeradas. */
export function retiradoCom(retirado, sku_code, qty) {
    const soma = porSku(retirado);
    const novo = (soma.get(sku_code) ?? 0) + (Number.isFinite(qty) ? qty : 0);
    if (novo > 0)
        soma.set(sku_code, novo);
    else
        soma.delete(sku_code);
    return [...soma].map(([sku, valor]) => ({ sku_code: sku, qty: valor }));
}
/** A ordem de saída: a guardada há mais tempo primeiro; sem data, depois; no empate, o código. */
export function ordemDeSaida(caixas) {
    return [...caixas].sort((left, right) => {
        const a = left.stored_at || "￿";
        const b = right.stored_at || "￿";
        return a < b ? -1 : a > b ? 1 : left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
    });
}
function daLinha(caixa, qty) {
    const zera = qty >= caixa.saldo;
    return { box_code: caixa.code, qty, inteira: zera && caixa.intacta, esvazia: zera && !caixa.intacta };
}
/**
 * A sugestão do sistema: a caixa mais antiga primeiro, a seguinte completa.
 * O que as caixas da prateleira não cobrem sai sem caixa.
 */
export function sugerirCaixas(pedido, caixas) {
    let falta = quantidade(pedido);
    const sugeridas = [];
    for (const caixa of ordemDeSaida(caixas)) {
        if (falta <= 0)
            break;
        const qty = Math.min(falta, quantidade(caixa.disponivel));
        if (!qty)
            continue;
        sugeridas.push(daLinha(caixa, qty));
        falta -= qty;
    }
    return { caixas: sugeridas, sem_caixa: falta };
}
/**
 * "Outra caixa": a pessoa informa de quais caixas da prateleira o item saiu.
 * Cada caixa tem de ter o item, na quantidade informada, e a soma tem de
 * fechar com a linha; só sai sem caixa o que as caixas da prateleira não têm.
 */
export function conferirCaixasInformadas(pedido, informadas, caixas) {
    const total = quantidade(pedido);
    const porCodigo = new Map();
    let naPrateleira = 0;
    for (const caixa of caixas) {
        porCodigo.set(caixa.code, caixa);
        naPrateleira += quantidade(caixa.disponivel);
    }
    const pedidas = new Map();
    for (const informada of informadas) {
        const codigo = typeof informada.box_code === "string" ? informada.box_code.trim().toUpperCase() : "";
        const qty = quantidade(informada.qty);
        if (!codigo || !qty)
            continue;
        pedidas.set(codigo, (pedidas.get(codigo) ?? 0) + qty);
    }
    const conferidas = [];
    let soma = 0;
    for (const [codigo, qty] of pedidas) {
        const caixa = porCodigo.get(codigo);
        const tem = quantidade(caixa?.disponivel);
        if (!caixa || !tem)
            return { problema: `A caixa ${codigo} não tem este item nesta prateleira.` };
        if (qty > tem)
            return { problema: `A caixa ${codigo} tem ${tem} un. deste item, e não ${qty}.` };
        conferidas.push(daLinha(caixa, qty));
        soma += qty;
    }
    const esperado = Math.min(total, naPrateleira);
    if (soma !== esperado)
        return { problema: `As caixas somam ${soma} un., e o separado nas caixas desta prateleira é de ${esperado} un.` };
    const ordem = new Map(ordemDeSaida(porCodigo.values()).map((caixa, index) => [caixa.code, index]));
    conferidas.sort((left, right) => (ordem.get(left.box_code) ?? 0) - (ordem.get(right.box_code) ?? 0));
    return { caixas: conferidas, sem_caixa: total - soma };
}
