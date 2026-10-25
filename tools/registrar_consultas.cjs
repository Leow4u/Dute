// Grava cada consulta que as Functions mandam ao Firestore nos testes de
// integração, para tools/indices_das_consultas.py conferir o índice de cada uma.
// O emulador não exige índice composto: a consulta sem ele passa nos testes e
// falha na produção com "requires an index".
//
// Os jobs de integração do CI carregam este arquivo com
// NODE_OPTIONS=--require <raiz>/tools/registrar_consultas.cjs e CONSULTAS_SAIDA
// apontando o arquivo onde gravar (uma linha JSON por consulta). Sem
// CONSULTAS_SAIDA, não faz nada.
//
// Toda consulta (get, stream, a leitura da transação e o count) passa por
// Query.toProto do @google-cloud/firestore, que monta o structuredQuery que vai
// ao servidor: é ali que se grava, com o banco e as linhas de lib/ de onde a
// consulta veio. O toProto roda depois de um passo assíncrono do SDK, quando a
// pilha já perdeu quem chamou: a origem se guarda antes, na entrada de
// _getResponse e _stream, ainda na chamada do código. O SDK é o que o
// firebase-admin da codebase resolve, a mesma instância que o código usa.
const fs = require("fs");
const path = require("path");

const saida = process.env.CONSULTAS_SAIDA;

function sdkDaCodebase() {
  try {
    const admin = require.resolve("firebase-admin/firestore", { paths: [process.cwd()] });
    return require(require.resolve("@google-cloud/firestore", { paths: [path.dirname(admin)] }));
  } catch {
    // Processo fora de uma codebase (o próprio firebase CLI, o tsc): nada a gravar.
    return null;
  }
}

/** As linhas de lib/ da pilha de agora: de onde, no código da codebase, a consulta veio. */
function origemAgora() {
  // Os quadros do SDK (o rastreamento do get) passam dos 10 que a pilha guarda por padrão.
  const limite = Error.stackTraceLimit;
  Error.stackTraceLimit = 60;
  const pilha = new Error().stack ?? "";
  Error.stackTraceLimit = limite;
  return pilha
    .split("\n")
    .filter((linha) => linha.includes("/lib/") && !linha.includes("node_modules"))
    .slice(0, 3)
    .map((linha) => linha.trim().replace(/^at /, "").replace(`${process.cwd()}/`, "").replace("file://", ""));
}

const sdk = saida ? sdkDaCodebase() : null;
if (sdk) {
  const ORIGEM = Symbol("origem da consulta");
  const gravadas = [];
  for (const entrada of ["_getResponse", "_stream"]) {
    const original = sdk.Query.prototype[entrada];
    sdk.Query.prototype[entrada] = function (...args) {
      const origem = origemAgora();
      if (origem.length) this[ORIGEM] = origem;
      return original.apply(this, args);
    };
  }
  const toProto = sdk.Query.prototype.toProto;
  sdk.Query.prototype.toProto = function (...args) {
    const proto = toProto.apply(this, args);
    try {
      const banco = /\/databases\/([^/]+)\//.exec(String(proto.parent))?.[1] ?? "(default)";
      gravadas.push(JSON.stringify({ banco, consulta: proto.structuredQuery, origem: this[ORIGEM] ?? origemAgora() }));
    } catch {
      // Gravar nunca muda a consulta.
    }
    return proto;
  };
  process.on("exit", () => {
    if (gravadas.length) fs.appendFileSync(saida, `${gravadas.join("\n")}\n`);
  });
}
