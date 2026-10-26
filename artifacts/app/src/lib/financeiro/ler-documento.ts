import { doc, getDoc, type DocumentData } from "firebase/firestore";

import { firestore } from "../firebase";

/**
 * Um documento lido uma vez, sem acompanhar (a via comercial da NF e o
 * rateio da receita por serviço leem as RVs e as medições assim).
 */
export async function lerDocumento(caminho: string): Promise<DocumentData | null> {
  if (!firestore) throw new Error("Firebase não configurado.");
  const snapshot = await getDoc(doc(firestore, caminho));
  return snapshot.exists() ? snapshot.data() : null;
}
