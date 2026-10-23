import { collection, query, where } from "firebase/firestore";

import { useAppUser } from "@/lib/auth";
import { minhasOs, saudacao } from "@/lib/campo/os-no-campo";
import { fichaDaLeitura } from "@/lib/operacao/ficha-da-os";
import { hojeIso } from "@/lib/operacao/fila";
import { useLeitura } from "@/lib/operacao/leitura";

import { CampoHojeView } from "./hoje-view";

/**
 * Campo › Minhas OS (parte 3.8b): as OS em que a pessoa está escalada. A
 * consulta é só por `equipe_uids`, o mesmo filtro que as regras pedem para o
 * campo ler a OS.
 */
export default function PaginaCampoHoje() {
  const { user } = useAppUser();
  const uid = user?.uid ?? null;
  const ordens = useLeitura(
    uid ? `service_orders:campo:${uid}` : null,
    (db) => query(collection(db, "service_orders"), where("equipe_uids", "array-contains", uid ?? "-")),
    fichaDaLeitura,
  );
  const hoje = hojeIso();
  const { dia, ola } = saudacao(user?.fullName, hoje);
  return (
    <CampoHojeView
      estado={ordens.erro ? "erro" : ordens.itens ? "pronto" : "carregando"}
      dia={dia}
      ola={ola}
      lista={minhasOs(ordens.itens ?? [], hoje)}
    />
  );
}
