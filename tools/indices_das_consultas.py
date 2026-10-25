"""Confere se cada consulta das Functions nos testes de integração tem índice.

O emulador do Firestore não exige índice composto: a consulta que pede um que
não está no arquivo de índices passa nos testes e falha na produção com
"requires an index". Os jobs de integração do CI carregam
tools/registrar_consultas.cjs, que grava em CONSULTAS_SAIDA cada consulta que o
SDK monta, com o banco dela. Este script confere cada forma de consulta contra o
arquivo de índices do banco (firebase.json; banco sem arquivo não tem índice
composto) e sai com 1 se faltar índice ou se nada foi gravado.

Confere só o que os testes exercitam: consulta nova entra com o teste que a usa.
O índice pedido segue o Firestore: as igualdades (em qualquer ordem), depois as
ordenações, com o campo de cada filtro de faixa sem ordenação própria no fim;
cada ramo de um OR pede o seu. Igualdades sem ordenação dispensam o composto, e
índices com as mesmas ordenações se juntam para cobrir as igualdades.

Uso, da raiz do repositório: python3 tools/indices_das_consultas.py <consultas.jsonl>
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from itertools import product
from pathlib import Path
from typing import Any

RAIZ = Path(__file__).resolve().parent.parent

IGUALDADE = {"EQUAL", "IN", "ARRAY_CONTAINS", "ARRAY_CONTAINS_ANY", "IS_NULL", "IS_NAN"}
CONTEM = {"ARRAY_CONTAINS", "ARRAY_CONTAINS_ANY"}

Ordem = tuple[str, str]


@dataclass(frozen=True)
class Forma:
    banco: str
    colecao: str
    escopo: str
    igualdades: tuple[str, ...]
    ordens: tuple[Ordem, ...]
    # Os campos das igualdades por array-contains: no índice, CONTAINS.
    contem: tuple[str, ...] = ()

    def _igualdade(self, campo: str) -> str:
        return "CONTAINS" if campo in self.contem else "ASCENDING"

    def descrever(self) -> str:
        campos = [f"{campo} {self._igualdade(campo)}" for campo in self.igualdades] + [f"{campo} {direcao}" for campo, direcao in self.ordens]
        grupo = "" if self.escopo == "COLLECTION" else f" [{self.escopo}]"
        banco = "" if self.banco == "(default)" else f" no banco {self.banco}"
        return f"{self.colecao}{grupo} ({', '.join(campos)}){banco}"

    def para_o_arquivo(self) -> dict[str, Any]:
        """O índice como se escreve no firestore.indexes.json."""
        return {
            "collectionGroup": self.colecao,
            "queryScope": self.escopo,
            "fields": [
                {"fieldPath": campo, "arrayConfig": "CONTAINS"} if campo in self.contem else {"fieldPath": campo, "order": "ASCENDING"}
                for campo in self.igualdades
            ]
            + [{"fieldPath": campo, "order": direcao} for campo, direcao in self.ordens],
        }


def ramos(filtro: dict[str, Any] | None) -> list[list[tuple[str, str]]]:
    """O filtro em forma normal disjuntiva: cada ramo é uma lista de (campo, operador)."""
    if not filtro:
        return [[]]
    if "fieldFilter" in filtro:
        return [[(filtro["fieldFilter"]["field"]["fieldPath"], filtro["fieldFilter"]["op"])]]
    if "unaryFilter" in filtro:
        return [[(filtro["unaryFilter"]["field"]["fieldPath"], filtro["unaryFilter"]["op"])]]
    composto = filtro["compositeFilter"]
    filhos = [ramos(filho) for filho in composto.get("filters", [])]
    if composto.get("op") == "OR":
        return [ramo for filho in filhos for ramo in filho]
    return [[condicao for parte in combinacao for condicao in parte] for combinacao in product(*filhos)]


def sem_id_implicito(ordens: list[Ordem]) -> list[Ordem]:
    """Sem a ordem pelo id no fim quando ela segue a direção da anterior: o Firestore a põe sozinho."""
    if ordens and ordens[-1][0] == "__name__":
        anterior = ordens[-2][1] if len(ordens) > 1 else "ASCENDING"
        if anterior == ordens[-1][1]:
            return ordens[:-1]
    return ordens


def formas(banco: str, consulta: dict[str, Any]) -> list[Forma]:
    """As formas que a consulta pede ao índice, uma por ramo do filtro."""
    origem = consulta["from"][0]
    colecao = origem["collectionId"]
    escopo = "COLLECTION_GROUP" if origem.get("allDescendants") else "COLLECTION"
    explicitas = [(ordem["field"]["fieldPath"], ordem.get("direction", "ASCENDING")) for ordem in consulta.get("orderBy", [])]
    saida = []
    for ramo in ramos(consulta.get("where")):
        igualdades = sorted({campo for campo, op in ramo if op in IGUALDADE and campo != "__name__"})
        contem = sorted({campo for campo, op in ramo if op in CONTEM})
        faixas = sorted({campo for campo, op in ramo if op not in IGUALDADE})
        ordens = list(explicitas)
        ordens += [(campo, "ASCENDING") for campo in faixas if campo not in {c for c, _ in ordens}]
        ordens = sem_id_implicito([ordem for ordem in ordens if ordem[0] not in igualdades])
        saida.append(Forma(banco, colecao, escopo, tuple(igualdades), tuple(ordens), tuple(contem)))
    return saida


def precisa_de_composto(forma: Forma) -> bool:
    """Igualdades sozinhas se juntam pelos índices de campo; uma ordenação só, sem igualdade, usa o do campo; a
    ordenação só pelo id também (o índice de campo descendente já guarda o id nessa direção)."""
    if all(campo == "__name__" for campo, _ in forma.ordens):
        return False
    return bool(forma.igualdades) or len(forma.ordens) > 1


Indice = tuple[str, str, tuple[Ordem, ...]]


def indices_por_banco(raiz: Path = RAIZ) -> dict[str, list[Indice]]:
    """Os índices compostos de cada banco do firebase.json; banco sem arquivo de índices não tem nenhum."""
    config = json.loads((raiz / "firebase.json").read_text(encoding="utf-8")).get("firestore", [])
    saida: dict[str, list[Indice]] = {}
    for banco in config if isinstance(config, list) else [config]:
        nome = banco.get("database", "(default)")
        saida[nome] = []
        if banco.get("indexes"):
            for indice in json.loads((raiz / banco["indexes"]).read_text(encoding="utf-8")).get("indexes", []):
                campos = [(campo["fieldPath"], campo.get("order") or campo.get("arrayConfig") or "") for campo in indice["fields"]]
                saida[nome].append((indice["collectionGroup"], indice.get("queryScope", "COLLECTION"), tuple(sem_id_implicito(campos))))
    return saida


def servida(forma: Forma, indices: list[Indice]) -> bool:
    """Um índice com as igualdades e as ordenações, ou vários com as mesmas ordenações que juntos cobrem as igualdades."""
    cobertas: set[str] = set()
    for colecao, escopo, campos in indices:
        if colecao != forma.colecao or escopo != forma.escopo:
            continue
        inicio = len(campos) - len(forma.ordens)
        if inicio < 0 or campos[inicio:] != forma.ordens:
            continue
        # A igualdade por array-contains só usa o campo em CONTAINS; as outras, o campo ordenado.
        if any((tipo == "CONTAINS") != (campo in forma.contem) for campo, tipo in campos[:inicio]):
            continue
        prefixo = {campo for campo, _ in campos[:inicio]}
        if not prefixo <= set(forma.igualdades):
            continue
        if prefixo == set(forma.igualdades):
            return True
        cobertas |= prefixo
    return bool(forma.igualdades) and cobertas == set(forma.igualdades)


def main(argv: list[str] | None = None, raiz: Path = RAIZ) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("uso: python3 tools/indices_das_consultas.py <consultas.jsonl>")
        return 2
    arquivo = Path(argv[0])
    linhas = [linha for linha in (arquivo.read_text(encoding="utf-8").splitlines() if arquivo.exists() else []) if linha.strip()]
    if not linhas:
        print(f"::error::Nenhuma consulta gravada em {arquivo}. O teste de integração carregou tools/registrar_consultas.cjs (NODE_OPTIONS e CONSULTAS_SAIDA)?")
        return 1

    indices = indices_por_banco(raiz)
    vistas: dict[Forma, set[str]] = {}
    for linha in linhas:
        gravada = json.loads(linha)
        for forma in formas(gravada.get("banco", "(default)"), gravada["consulta"]):
            vistas.setdefault(forma, set()).add(" < ".join(gravada.get("origem", [])))

    faltam = [forma for forma in vistas if precisa_de_composto(forma) and not servida(forma, indices.get(forma.banco, []))]
    print(f"{len(linhas)} consultas gravadas, {len(vistas)} formas, {sum(precisa_de_composto(forma) for forma in vistas)} com índice composto.")
    for forma in sorted(faltam, key=Forma.descrever):
        print(f"::error::Consulta sem índice: {forma.descrever()}. No arquivo de índices do banco:")
        print(f"  {json.dumps(forma.para_o_arquivo(), ensure_ascii=False)}")
        for origem in sorted(vistas[forma])[:3]:
            print(f"  de {origem or '(sem linha de lib/)'}")
    return 1 if faltam else 0


if __name__ == "__main__":
    sys.exit(main())
