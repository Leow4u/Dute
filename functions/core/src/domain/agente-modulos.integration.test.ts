import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";

import { FERRAMENTAS_DO_AGENTE } from "./agente-catalogo.js";
import { DADOS_DOS_MODULOS } from "./agente-dados.test.js";
import { modulosDoEscopo, type EscopoDoAgente } from "./agente-escopo.js";
import { executarFerramenta, ferramentasDoEscopo } from "./agente-ferramentas.js";
import { leitorDoAgente } from "./agente-leitor.js";
import { leValor, type PlatformRole } from "./platform-roles.js";

/**
 * As ferramentas da Operação, do Comercial, do Financeiro e da memória no
 * emulador (parte 5.5d): as consultas de verdade, com a agenda pelo dia da
 * janela, o "in" do a receber, a tabela Padrão sem cliente e a ordem de cada
 * lista. Nenhuma devolve dado do outro cliente. Dados sintéticos.
 */

const PROJECT_ID = "demo-dute-core";
const AGORA = new Date("2026-10-23T15:00:00.000Z");

let db: Firestore;
let app: ReturnType<typeof initializeApp>;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "core-agente-modulos-test");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

function gravado(dados: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(dados).map(([chave, valor]) => [chave, chave.endsWith("_at") && typeof valor === "string" ? Timestamp.fromDate(new Date(valor)) : valor]));
}

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  const batch = db.batch();
  for (const [colecao, documentos] of Object.entries(DADOS_DOS_MODULOS)) {
    for (const [id, dados] of Object.entries(documentos)) batch.set(db.collection(colecao).doc(id), gravado(dados));
  }
  await batch.commit();
});

function escopo(role: PlatformRole, customerCode = "ITAU"): EscopoDoAgente {
  const modulos = modulosDoEscopo(role, ["wms", "operacao", "financeiro"]);
  return { uid: `${role}-1`, role, nome: null, audiencia: role === "cliente" ? "cliente" : "equipe", customerCode, modulo: modulos[0] ?? "wms", modulos, leValor: leValor(role), modeloDeOperacao: null };
}

const ENTRADAS: Record<string, unknown> = {
  ver_demanda: { numero: "10050" },
  agenda: { de: "2026-10-23", ate: "2026-10-30" },
  ver_os: { numero: "10050-01" },
  tempo_dos_itens: { texto: "" },
  ver_orcamento: { numero: "10050" },
  lpu: { texto: "mesa" },
  orcamentos_parecidos: { demanda: "10050" },
};

async function rodar(nome: string, alvo: EscopoDoAgente, entrada: unknown = ENTRADAS[nome] ?? {}) {
  const item = FERRAMENTAS_DO_AGENTE.find((ferramenta) => ferramenta.nome === nome)!;
  return executarFerramenta(item, { leitor: leitorDoAgente(db, alvo), escopo: alvo, agora: AGORA }, entrada) as Promise<Record<string, any>>;
}

const MODULOS_NOVOS = ["operacao", "comercial", "financeiro"];

describe("as ferramentas dos módulos no banco", () => {
  it("todas respondem com as consultas de verdade, sem o outro cliente", async () => {
    for (const item of ferramentasDoEscopo(escopo("owner"), FERRAMENTAS_DO_AGENTE).filter((ferramenta) => ferramenta.modulo && MODULOS_NOVOS.includes(ferramenta.modulo))) {
      assert.doesNotMatch(JSON.stringify(await rodar(item.nome, escopo("owner"))), /SAFRA/, item.nome);
    }
  });

  it("a agenda pelo dia da janela, a lista na ordem e o a receber pelo 'in'", async () => {
    assert.deepEqual((await rodar("agenda", escopo("cliente"))).agenda.map((os: Record<string, unknown>) => os.numero), ["10050-01"]);
    assert.deepEqual((await rodar("agenda", escopo("cliente", "SAFRA"))).agenda.map((os: Record<string, unknown>) => os.numero), ["10090-01"]);
    assert.deepEqual((await rodar("orcamentos", escopo("comercial"))).orcamentos.map((linha: Record<string, unknown>) => linha.numero), ["10051", "10050"]);
    const aberto = await rodar("a_receber", escopo("financeiro"));
    assert.deepEqual(aberto.servicos.faturas.map((linha: Record<string, unknown>) => linha.nf), ["1234 série 1", "1300"]);
  });

  it("a tabela Padrão é a sem cliente, e a medida geral só a geral", async () => {
    const semTabela = await rodar("lpu", escopo("comercial", "NOVO"));
    assert.equal(semTabela.tabela.nome, "Padrão Dutelog");
    const tempos = await rodar("tempo_dos_itens", escopo("interno"));
    assert.deepEqual(tempos.itens.map((item: Record<string, unknown>) => [item.item, item.base]), [
      ["Armário", "média de todos os clientes"],
      ["Cadeira", "ainda sem base"],
      ["Mesa", "deste cliente"],
    ]);
    const parecidos = await rodar("orcamentos_parecidos", escopo("comercial"));
    assert.deepEqual(parecidos.casos.map((caso: Record<string, unknown>) => caso.demanda), ["10049"]);
  });
});
