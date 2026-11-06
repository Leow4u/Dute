/**
 * O Firestore das ferramentas da padronização dos nomes, igual para o
 * relatório (passo 1) e para a aplicação (passo 3): o firebase-admin vem de
 * functions/wms, com a credencial padrão da conta (`gcloud auth
 * application-default login`) ou com o emulador local, sempre com projeto
 * demo-* (nunca a nuvem com a variável do emulador ligada).
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Abre o projeto; `abortar(mensagem)` encerra com a frase do que fazer. */
export function abrirFirestore(projeto, abortar) {
  const emuladorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  const emulador = Boolean(emuladorHost);
  if (emulador && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(emuladorHost)) {
    abortar(`FIRESTORE_EMULATOR_HOST precisa apontar para 127.0.0.1 ou localhost (está ${emuladorHost}).`);
  }
  if (emulador && !/^demo-/.test(projeto)) {
    abortar(`Com FIRESTORE_EMULATOR_HOST o projeto precisa ser demo-* (está ${projeto}). Para a nuvem, limpe a variável antes de rodar.`);
  }
  process.env.GCLOUD_PROJECT = projeto;
  process.env.GOOGLE_CLOUD_PROJECT = projeto;
  if (emulador) {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.METADATA_SERVER_DETECTION = "none";
  }

  const requireWms = createRequire(path.join(RAIZ, "functions", "wms", "package.json"));
  let adminApp;
  let adminFirestore;
  try {
    adminApp = requireWms("firebase-admin/app");
    adminFirestore = requireWms("firebase-admin/firestore");
  } catch {
    abortar("firebase-admin não encontrado em functions/wms. Rode: npm --prefix functions/wms ci");
  }
  const app = adminApp.initializeApp({ projectId: projeto });
  return { app, db: adminFirestore.getFirestore(app), FieldPath: adminFirestore.FieldPath, FieldValue: adminFirestore.FieldValue, emulador };
}

/** A coleção inteira, em páginas de 500 pelo id: uma leitura pela metade sairia errada, não só incompleta. */
export async function lerColecao(db, FieldPath, colecao) {
  const todos = [];
  let ultimo = null;
  for (;;) {
    let consulta = db.collection(colecao).orderBy(FieldPath.documentId()).limit(500);
    if (ultimo) consulta = consulta.startAfter(ultimo);
    const pagina = await consulta.get();
    for (const doc of pagina.docs) todos.push({ ...doc.data(), id: doc.id });
    if (pagina.size < 500) return todos;
    ultimo = pagina.docs[pagina.docs.length - 1].id;
  }
}
