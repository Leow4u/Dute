#!/usr/bin/env node
/**
 * Seed do ambiente local (docs/plataforma/ambiente-local.md).
 *
 * Grava usuários de teste no Auth emulado e dados SINTÉTICOS do Comercial no
 * Firestore emulado, pelas funções de domínio de functions/comercial (as mesmas
 * das callables), para o dado sair consistente: recibos, eventos, números de
 * demanda e RV iguais aos do sistema.
 *
 * Uso (com os emuladores no ar, na raiz do repositório):
 *
 *   $env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8188"
 *   $env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9199"
 *   node tools/emulador-local/seed.mjs            # primeira vez
 *   node tools/emulador-local/seed.mjs --refazer  # apaga o emulador e semeia de novo
 *
 * TRAVA: sem as duas variáveis, apontando para a própria máquina, o script
 * aborta sem fazer nada. Ele nunca fala com a nuvem.
 *
 * Pré-requisito: `npm --prefix functions/comercial run build` (usa lib/).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// --- Trava: só emulador local --------------------------------------------------

const PROJETO = "dute-homolog";
const LOCAIS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function hostLocal(nome) {
  const valor = process.env[nome];
  if (!valor) return null;
  const host = valor.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
  return LOCAIS.has(host) ? valor.replace(/^https?:\/\//, "") : null;
}

function abortar(mensagem) {
  console.error(`\nSeed abortado, nada foi feito.\n${mensagem}\n`);
  process.exit(1);
}

const firestoreHost = hostLocal("FIRESTORE_EMULATOR_HOST");
const authHost = hostLocal("FIREBASE_AUTH_EMULATOR_HOST");
if (!firestoreHost || !authHost) {
  abortar(
    "FIRESTORE_EMULATOR_HOST e FIREBASE_AUTH_EMULATOR_HOST precisam estar definidas e apontar para 127.0.0.1 ou localhost.\n" +
      'Exemplo: $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8188"; $env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9199"',
  );
}
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
process.env.GCLOUD_PROJECT = PROJETO;
process.env.GOOGLE_CLOUD_PROJECT = PROJETO;

// --- Dependências do functions/comercial --------------------------------------------

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMERCIAL = path.join(RAIZ, "functions", "comercial");
const requireComercial = createRequire(path.join(COMERCIAL, "package.json"));

let adminApp, adminAuth, adminFirestore;
try {
  adminApp = requireComercial("firebase-admin/app");
  adminAuth = requireComercial("firebase-admin/auth");
  adminFirestore = requireComercial("firebase-admin/firestore");
} catch {
  abortar("firebase-admin não encontrado em functions/comercial. Rode: npm --prefix functions/comercial ci");
}

async function dominio(arquivo) {
  try {
    return await import(pathToFileURL(path.join(COMERCIAL, "lib", arquivo)).href);
  } catch (erro) {
    abortar(`Não consegui carregar functions/comercial/lib/${arquivo}. Rode: npm --prefix functions/comercial run build\n${erro.message}`);
  }
}

const cadastro = await dominio("domain/cadastro.js");
const contratos = await dominio("domain/contratos.js");
const quotes = await dominio("domain/quotes.js");
const demandas = await dominio("domain/demandas.js");
const medicoes = await dominio("domain/medicoes.js");
const catalogo = await dominio("domain/catalogo.js");
const cargaTabela = await dominio("cargas/tabela.js");

const app = adminApp.initializeApp({ projectId: PROJETO });
const auth = adminAuth.getAuth(app);
const db = adminFirestore.getFirestore(app);

// --- Usuários de teste ------------------------------------------------------------

/** Senha dos usuários de teste. Vale só no Auth emulado: não existe na nuvem. */
const SENHA_DE_TESTE = "Teste@2026-local";

const USUARIOS = [
  { uid: "u-owner", email: "owner@teste.local", nome: "Owner Teste", role: "owner" },
  { uid: "u-admin", email: "admin@teste.local", nome: "Admin Teste", role: "admin" },
  { uid: "u-comercial", email: "comercial@teste.local", nome: "Comercial Teste", role: "comercial" },
  { uid: "u-financeiro", email: "financeiro@teste.local", nome: "Financeiro Teste", role: "financeiro" },
  { uid: "u-interno", email: "interno@teste.local", nome: "Interno Teste", role: "interno" },
  { uid: "u-cliente-btg", email: "cliente.btg@teste.local", nome: "Cliente BTG Teste", role: "cliente", customer_code: "BTG Pactual" },
];

const perfil = (uid) => {
  const u = USUARIOS.find((item) => item.uid === uid);
  return { uid: u.uid, role: u.role, name: u.nome, email: u.email };
};
const owner = perfil("u-owner");
const comercial = perfil("u-comercial");

// --- Utilitários -------------------------------------------------------------------

let sequencia = 0;
const chave = (prefixo = "seed") => `${prefixo}-${(sequencia += 1)}`;

function dataIso(deslocamentoEmDias) {
  const d = new Date(Date.now() + deslocamentoEmDias * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function instanteIso(deslocamentoEmDias) {
  const d = new Date(Date.now() + deslocamentoEmDias * 86_400_000);
  const pad = (n) => String(n).padStart(2, "0");
  const sp = new Date(d.getTime() - 3 * 3_600_000);
  return `${sp.getUTCFullYear()}-${pad(sp.getUTCMonth() + 1)}-${pad(sp.getUTCDate())}T${pad(sp.getUTCHours())}:${pad(sp.getUTCMinutes())}:00-03:00`;
}

async function doc(caminho) {
  const snapshot = await db.doc(caminho).get();
  if (!snapshot.exists) throw new Error(`${caminho} não existe`);
  return snapshot.data();
}

async function limparEmuladores() {
  const f = await fetch(`http://${firestoreHost}/emulator/v1/projects/${PROJETO}/databases/(default)/documents`, { method: "DELETE" });
  const a = await fetch(`http://${authHost}/emulator/v1/projects/${PROJETO}/accounts`, { method: "DELETE" });
  if (!f.ok || !a.ok) throw new Error(`Não consegui limpar os emuladores (Firestore ${f.status}, Auth ${a.status}).`);
}

// --- 1. Auth e perfis ----------------------------------------------------------------

async function semearUsuarios() {
  for (const u of USUARIOS) {
    await auth.createUser({ uid: u.uid, email: u.email, password: SENHA_DE_TESTE, displayName: u.nome, emailVerified: true });
    const perfilDoc = { id: u.uid, email: u.email, nome: u.nome, role: u.role, status: "active", created_at: adminFirestore.FieldValue.serverTimestamp() };
    if (u.customer_code) perfilDoc.customer_code = u.customer_code;
    await db.collection("users").doc(u.uid).set(perfilDoc);
  }
}

// --- 2. Cadastro -------------------------------------------------------------------

/** A BTG legada: sem stage e com sigla, como o WMS a guarda. */
async function semearBtgLegada() {
  const code = "BTG Pactual";
  await db.collection("customers").doc("BTG_Pactual").set({
    id: "BTG_Pactual",
    code,
    customer_code: code,
    name: "BTG Pactual (teste)",
    sku_prefix: "BTG",
    operation_template: "uniformes",
    status: "active",
    archived: false,
    portal_status: "active",
    modules: ["wms", "financeiro"],
  });
  await escreverProjecoes("BTG_Pactual", code, "BTG Pactual (teste)", "BTG", "uniformes");
}

async function escreverProjecoes(id, code, name, sigla, modelo) {
  await db.collection("client_profiles").doc(id).set({
    id,
    customer_code: code,
    name,
    operation_template: modelo,
    sku_prefix: sigla,
    portal_status: "active",
    status: "active",
    archived: false,
    modules: ["wms", "financeiro"],
    updated_at: adminFirestore.FieldValue.serverTimestamp(),
  });
  await db.collection("client_access").doc(code).set({ customer_code: code, modules: ["wms", "financeiro"] });
}

/** Cliente de teste pelo caminho do Comercial (prospect, depois cliente), mais a sigla do WMS. */
async function semearCliente(code, name, sigla) {
  await cadastro.saveCommercialCustomerFor(db, comercial, {
    action: "create",
    idempotency_key: chave("cli"),
    name,
    code,
    comercial: { responsavel_uid: comercial.uid, cidade: "São Paulo", uf: "SP" },
  });
  await cadastro.saveCommercialCustomerFor(db, comercial, { action: "mark_client", idempotency_key: chave("cli"), customer_code: code });
  await db.collection("customers").doc(code).update({ sku_prefix: sigla, operation_template: "uniformes", modules: ["wms", "financeiro"] });
  await escreverProjecoes(code, code, name, sigla, "uniformes");
}

async function semearProspect(code, name, cidade, uf) {
  await cadastro.saveCommercialCustomerFor(db, comercial, {
    action: "create",
    idempotency_key: chave("pro"),
    name,
    code,
    comercial: { responsavel_uid: comercial.uid, cidade, uf },
  });
}

async function local(customer_code, nome, sigla, cidade) {
  const r = await cadastro.saveCustomerLocationFor(db, comercial, {
    idempotency_key: chave("loc"),
    customer_code,
    nome,
    sigla,
    endereco: { logradouro: "Rua de Teste", numero: "100", bairro: "Centro", cidade, uf: "SP", cep: "01000-000" },
  });
  return r.local_id;
}

async function contato(customer_code, nome, email, empresa) {
  const r = await cadastro.saveCustomerContactFor(db, comercial, {
    idempotency_key: chave("ctt"),
    customer_code,
    nome,
    email,
    telefone: "11900001234",
    empresa,
  });
  return r.contato_id;
}

// --- 3. Contratos -------------------------------------------------------------------

function dadosDoContrato(customer_code, nome, extra) {
  return {
    customer_code,
    nome,
    numeros: [{ tipo: "contrato", numero: `TESTE-${customer_code}-0001` }],
    objeto: "Contrato sintético para conferir as telas. Nada aqui é real.",
    vigente_de: "2026-01-01",
    vigente_ate: "2027-12-31",
    renovacao: { tipo: "aditivo", aviso_dias: 30 },
    reajuste: { tipo: "negociado" },
    codigo_servico: "1602",
    documentos: [],
    status: "vigente",
    ...extra,
  };
}

async function contrato(id, dados) {
  await contratos.salvarContrato(db, comercial, { idempotency_key: chave("ct"), acao: "criar", contrato_id: id, contrato: dados });
}

// --- 4. Tabelas (pela carga real, em CSV sintético) --------------------------------

const CABECALHO = "codigo;categoria;item;servico;descricao;unidade;preco";
const ITENS = [
  ["TST-0001-T", "Mobiliário", "Mesa de escritório", "Transporte", "Transporte de mesa de escritório", "UN", 45],
  ["TST-0001-M", "Mobiliário", "Mesa de escritório", "Montagem", "Montagem de mesa de escritório", "UN", 32],
  ["TST-0002-T", "Mobiliário", "Cadeira giratória", "Transporte", "Transporte de cadeira giratória", "UN", 18.5],
  ["TST-0002-M", "Mobiliário", "Cadeira giratória", "Montagem", "Montagem de cadeira giratória", "UN", 12],
  ["TST-0003-T", "Mobiliário", "Armário alto", "Transporte", "Transporte de armário alto", "UN", 70],
  ["TST-0003-M", "Mobiliário", "Armário alto", "Montagem", "Montagem de armário alto", "UN", 55],
  ["TST-0004-T", "Mobiliário", "Gaveteiro", "Transporte", "Transporte de gaveteiro", "UN", 22],
  ["TST-0005-I", "Mobiliário", "Cofre", "Içamento", "Içamento de cofre", "VB", 1450],
  ["TST-0006-D", "Diárias", "Ajudante", "Diária seg–sex", "Diária de ajudante, segunda a sexta", "UN", 280],
  ["TST-0006-S", "Diárias", "Ajudante", "Diária sábado", "Diária de ajudante, sábado", "UN", 364],
  ["TST-0007-V", "Viagens", "VUC", "Viagem", "Viagem de VUC", "UN", 620],
  ["TST-0008-V", "Viagens", "Truck", "Viagem", "Viagem de truck", "UN", 1350],
  ["TST-0100", "Armazenagem", "Pallet", "Prestação de serviço", "Armazenagem de pallet", "M³/MÊS", 55],
];

const PASTA_TEMP = mkdtempSync(path.join(tmpdir(), "dute-seed-"));

async function tabela({ arquivo, nome, variante, fator, cliente, contratoId, validadeDias }) {
  const linhas = ITENS.map(([cod, cat, nomeItem, serv, desc, un, preco]) => [cod, cat, nomeItem, serv, desc, un, (preco * fator).toFixed(2)].join(";"));
  const caminho = path.join(PASTA_TEMP, `${arquivo}.csv`);
  writeFileSync(caminho, [CABECALHO, ...linhas].join("\n"), "utf8");
  const argv = ["--arquivo", caminho, "--nome", nome, "--variante", variante, "--vigente-de", "2026-01-01", "--projeto", PROJETO, "--executar", "--por", owner.email];
  if (cliente) argv.push("--cliente", cliente, "--contrato", contratoId);
  if (validadeDias) argv.push("--validade-dias", String(validadeDias));
  const pastaRelatorio = path.join(PASTA_TEMP, "relatorios");
  mkdirSync(pastaRelatorio, { recursive: true });
  const resultado = await cargaTabela.rodarCarga(argv, {
    abrirBanco: () => db,
    pastaDoRelatorio: pastaRelatorio,
    env: { FIRESTORE_EMULATOR_HOST: firestoreHost },
    log: () => {},
  });
  if (!resultado.ok) throw new Error(`Tabela ${nome}/${variante}: ${resultado.erros.join(" | ")}`);
}

// --- 5. Orçamentos ------------------------------------------------------------------

async function orcamentoAvancar(caller, action, numero, extra = {}) {
  const quote = await doc(`quotes/${numero}`);
  return quotes.advanceQuoteFor(db, caller, {
    action,
    request_id: chave("adv"),
    numero,
    expected_status: quote.status,
    expected_edicao: quote.edicao,
    ...extra,
  });
}

async function demandaAvancar(caller, action, numero, extra = {}) {
  const [dem, quote] = await Promise.all([doc(`demands/${numero}`), doc(`quotes/${numero}`)]);
  return demandas.advanceDemandFor(db, caller, {
    action,
    request_id: chave("dem"),
    numero,
    expected_etapa: dem.etapa,
    expected_rv: quote.rv,
    ...extra,
  });
}

const item = (categoria, nomeItem, servico, unidade) => catalogo.lpuItemId({ categoria, item: nomeItem, servico, unidade });

async function novoOrcamento(ctx, titulo, ref, linhas, extra = {}) {
  const r = await quotes.saveQuoteFor(db, comercial, {
    action: "create",
    request_id: chave("orc"),
    customer_code: "ALFA",
    contrato_id: "alfa-2026",
    contato_id: ctx.contatoGerenciadora,
    canal: "email",
    tipo: "planejada",
    titulo,
    ref_cliente: ref,
    recebida_em: instanteIso(-2),
    origem: { local_id: ctx.localSede, complemento: "3º andar" },
    destino: { local_id: ctx.localFilial, complemento: null },
    execucao: { datas: [], de: dataIso(7), ate: dataIso(8), a_definir: false },
    linhas,
    ...extra,
  });
  return r.numero;
}

async function semearOrcamentos(ctx) {
  const mesa = item("Mobiliário", "Mesa de escritório", "Transporte", "UN");
  const cadeira = item("Mobiliário", "Cadeira giratória", "Transporte", "UN");
  const armario = item("Mobiliário", "Armário alto", "Transporte", "UN");
  const cofre = item("Mobiliário", "Cofre", "Içamento", "VB");
  const tab = (id, quantidade) => ({ origem: "tabela", lpu_item_id: id, quantidade });
  const numeros = {};

  // 1. Rascunho.
  numeros.rascunho = await novoOrcamento(ctx, "Mudança de layout, 3º andar", "REQ-0001", [tab(mesa, "10"), tab(cadeira, "20")]);

  // 2. Para aprovar (tabela Noturna).
  numeros.paraAprovar = await novoOrcamento(ctx, "Remanejamento noturno da filial", "REQ-0002", [tab(mesa, "6"), tab(armario, "4")], { variante: "Noturna" });
  await orcamentoAvancar(comercial, "submit", numeros.paraAprovar);

  // 3. Aguardando o cliente (aprovado pelo owner e enviado).
  numeros.aguardandoCliente = await novoOrcamento(ctx, "Içamento de cofre", "REQ-0003", [tab(cofre, "1"), tab(cadeira, "5")]);
  await orcamentoAvancar(comercial, "submit", numeros.aguardandoCliente);
  await orcamentoAvancar(owner, "approve", numeros.aguardandoCliente);
  await orcamentoAvancar(comercial, "send", numeros.aguardandoCliente);

  // 4. Demanda executada, RV de execução validada: aguardando a autorização de faturamento.
  numeros.aguardandoAutorizacao = await novoOrcamento(ctx, "Mudança concluída, aguardando pedido", "REQ-0004", [tab(mesa, "24"), tab(cadeira, "48")], {
    execucao: { datas: [], de: null, ate: null, a_definir: true },
  });
  const n = numeros.aguardandoAutorizacao;
  await orcamentoAvancar(comercial, "submit", n);
  await orcamentoAvancar(owner, "approve", n);
  await orcamentoAvancar(comercial, "send", n);
  await demandaAvancar(comercial, "close", n, { contato_id: ctx.contatoGerenciadora });
  await demandaAvancar(comercial, "register_execution", n, { executado_de: dataIso(-4), executado_ate: dataIso(-3) });
  await orcamentoAvancar(comercial, "revise", n, { motivo: "execucao" });
  const revisao = await doc(`quotes/${n}`);
  const [l1, l2] = revisao.linhas;
  await quotes.saveQuoteFor(db, comercial, {
    action: "update",
    request_id: chave("orc"),
    numero: n,
    expected_edicao: revisao.edicao,
    linhas: [
      { id: l1.id, origem: "tabela", lpu_item_id: mesa, quantidade: "22" },
      { id: l2.id, origem: "tabela", lpu_item_id: cadeira, quantidade: "48" },
    ],
  });
  await orcamentoAvancar(comercial, "send", n);
  await demandaAvancar(comercial, "validate", n, { contato_id: ctx.contatoGerenciadora });
  return numeros;
}

// --- 6. Medição ---------------------------------------------------------------------

async function semearMedicao() {
  const agora = new Date();
  const competencia = `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, "0")}`;
  const aberta = await medicoes.saveMedicaoFor(db, comercial, { action: "create", request_id: chave("med"), contrato_id: "beta-2026", competencia });
  const primeiroDia = `${competencia}-01`;
  await medicoes.saveMedicaoFor(db, comercial, {
    action: "upsert_line",
    request_id: chave("med"),
    medicao_id: aberta.medicao_id,
    expected_edicao: aberta.edicao,
    linha: {
      os: "OS-TESTE-0001",
      solicitada_em: primeiroDia,
      area_solicitante: "Facilities",
      executada_em: primeiroDia,
      janela: "diurna",
      origem: "Sede",
      destino: "Agência Centro",
      mercadoria: "18 caixas de arquivo",
      itens: [
        { origem: "tabela", lpu_item_id: item("Diárias", "Ajudante", "Diária seg–sex", "UN"), quantidade: "2" },
        { origem: "tabela", lpu_item_id: item("Viagens", "VUC", "Viagem", "UN"), quantidade: "1" },
      ],
      anexo: { nome: "OS-TESTE-0001.pdf", referencia: "anexo fictício" },
    },
  });
  return aberta.medicao_id;
}

// --- Execução ----------------------------------------------------------------------

const refazer = process.argv.includes("--refazer");

try {
  const jaTem = (await db.collection("users").limit(1).get()).size > 0;
  if (jaTem && !refazer) {
    abortar("O emulador já tem dados. Rode com --refazer para apagar o emulador (só ele) e semear de novo.");
  }
  if (refazer) await limparEmuladores();

  console.log("Usuários de teste...");
  await semearUsuarios();

  console.log("Cadastro: BTG legada, clientes e prospects...");
  await semearBtgLegada();
  await semearCliente("ALFA", "Cliente Alfa", "ALFA");
  await semearCliente("BETA", "Cliente Beta", "BETA");
  await semearProspect("GAMA", "Prospect Gama", "Campinas", "SP");
  await semearProspect("DELTA", "Prospect Delta", "Santos", "SP");

  const localSede = await local("ALFA", "Sede Alfa", "SEDE", "São Paulo");
  const localFilial = await local("ALFA", "Filial Alfa", "FILIAL", "Campinas");
  await local("BETA", "Matriz Beta", "MATRIZ", "São Paulo");
  const contatoGerenciadora = await contato("ALFA", "Renata Teste", "renata@gerenciadora.teste.local", "Gerenciadora Teste Ltda");
  await contato("ALFA", "Paulo Teste", "paulo@alfa.teste.local", null);
  await contato("BETA", "Lúcia Teste", "lucia@beta.teste.local", null);

  console.log("Contratos...");
  await contrato(
    "alfa-2026",
    dadosDoContrato("ALFA", "Contrato de serviços, Cliente Alfa", {
      regimes: [{ servico: "Mudança", regime: "por_demanda" }],
      regime_padrao: "por_demanda",
      autorizacao: { tipo: "pedido_aceite", prazo_perda_dias: null },
      pagamento: {
        tipo: "faixas_do_dia_da_nf",
        faixas: [
          { de: 1, ate: 10, dia: 30, mes: "mesmo" },
          { de: 11, ate: 20, dia: 10, mes: "seguinte" },
          { de: 21, ate: 31, dia: 30, mes: "seguinte" },
        ],
      },
    }),
  );
  await contrato(
    "beta-2026",
    dadosDoContrato("BETA", "Contrato de medição mensal, Cliente Beta", {
      regimes: [],
      regime_padrao: "medicao_mensal",
      autorizacao: { tipo: "medicao_aprovada", prazo_perda_dias: null },
      pagamento: { tipo: "dias_apos_nf", faixas: [], dias: 30 },
    }),
  );

  console.log("Tabelas de preço (Padrão, Alfa Comercial e Noturna, Beta)...");
  await tabela({ arquivo: "padrao", nome: "Padrão Dutelog", variante: "Comercial", fator: 1 });
  await tabela({ arquivo: "alfa-comercial", nome: "LPU Cliente Alfa v1", variante: "Comercial", fator: 1.08, cliente: "ALFA", contratoId: "alfa-2026", validadeDias: 30 });
  await tabela({ arquivo: "alfa-noturna", nome: "LPU Cliente Alfa v1", variante: "Noturna", fator: 1.4, cliente: "ALFA", contratoId: "alfa-2026", validadeDias: 30 });
  await tabela({ arquivo: "beta-comercial", nome: "LPU Cliente Beta v1", variante: "Comercial", fator: 0.95, cliente: "BETA", contratoId: "beta-2026" });

  console.log("Orçamentos e demandas do Cliente Alfa...");
  const numeros = await semearOrcamentos({ localSede, localFilial, contatoGerenciadora });

  console.log("Medição do Cliente Beta...");
  const medicao = await semearMedicao();

  console.log("\nPronto.");
  console.log(`  Orçamentos: rascunho ${numeros.rascunho}, para aprovar ${numeros.paraAprovar}, aguardando cliente ${numeros.aguardandoCliente}, aguardando autorização ${numeros.aguardandoAutorizacao}`);
  console.log(`  Medição em rascunho: ${medicao}`);
  console.log(`  Senha de todos os usuários de teste: ${SENHA_DE_TESTE}`);
  for (const u of USUARIOS) console.log(`  ${u.role.padEnd(11)} ${u.email}`);
} catch (erro) {
  console.error("\nO seed falhou:", erro);
  process.exitCode = 1;
} finally {
  rmSync(PASTA_TEMP, { recursive: true, force: true });
  await adminApp.deleteApp(app);
}
