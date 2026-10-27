// Read-only publication gate. No credentials, no operational mutations.
import assert from "node:assert/strict";
import { openapi } from "../functions/operacao/lib/api/openapi.js";

const project = process.argv[2];
assert.ok(
  ["dute-prod", "dute-homolog"].includes(project),
  "Informe dute-prod ou dute-homolog",
);
const base = `https://southamerica-east1-${project}.cloudfunctions.net/duteApi/api/v1`;
const contract = await fetch(`${base}/openapi.json`, {
  signal: AbortSignal.timeout(30000),
});
assert.equal(contract.status, 200, "Contrato da API não está acessível");
assert.deepEqual(
  await contract.json(),
  openapi,
  "API publicada difere do contrato deste commit",
);
const anonymous = await fetch(`${base}/operacao/os?customer_code=SMOKE`, {
  signal: AbortSignal.timeout(30000),
});
assert.equal(
  anonymous.status,
  401,
  "Consulta anônima não foi recusada com 401",
);
const body = await anonymous.json();
assert.equal(body.error.code, "unauthenticated");
assert.ok(body.request_id);
console.log(
  `API ${project}: contrato deste commit e acesso anônimo recusado. Nenhum dado operacional gravado.`,
);
