"""Testes de tools/indices_das_consultas.py.

Rodar da raiz do repositório:

    python -m unittest discover -s tools -p "test_*.py" -v
"""

from __future__ import annotations

import io
import json
import re
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any

import indices_das_consultas as c


def campo(nome: str, op: str) -> dict[str, Any]:
    return {"fieldFilter": {"field": {"fieldPath": nome}, "op": op, "value": {"stringValue": "x"}}}


def e(*filtros: dict[str, Any]) -> dict[str, Any]:
    return {"compositeFilter": {"op": "AND", "filters": list(filtros)}}


def ou(*filtros: dict[str, Any]) -> dict[str, Any]:
    return {"compositeFilter": {"op": "OR", "filters": list(filtros)}}


def consulta(colecao: str, where: dict[str, Any] | None = None, ordens: list[tuple[str, str]] | None = None, grupo: bool = False) -> dict[str, Any]:
    saida: dict[str, Any] = {"from": [{"collectionId": colecao, **({"allDescendants": True} if grupo else {})}]}
    if where:
        saida["where"] = where
    if ordens:
        saida["orderBy"] = [{"field": {"fieldPath": nome}, "direction": direcao} for nome, direcao in ordens]
    return saida


def indice(colecao: str, *campos: tuple[str, str], escopo: str = "COLLECTION") -> c.Indice:
    return (colecao, escopo, tuple(campos))


class FormasTest(unittest.TestCase):
    def test_igualdade_e_ordem(self) -> None:
        [forma] = c.formas("(default)", consulta("events", campo("customer_code", "EQUAL"), [("occurred_at", "DESCENDING")]))
        self.assertEqual((forma.igualdades, forma.ordens), (("customer_code",), (("occurred_at", "DESCENDING"),)))
        self.assertTrue(c.precisa_de_composto(forma))

    def test_a_faixa_sem_ordem_entra_no_fim(self) -> None:
        [forma] = c.formas("(default)", consulta("service_orders", e(campo("customer_code", "EQUAL"), campo("janela.data", "GREATER_THAN_OR_EQUAL"))))
        self.assertEqual(forma.ordens, (("janela.data", "ASCENDING"),))

    def test_o_id_no_fim_na_mesma_direcao_sai(self) -> None:
        [forma] = c.formas("(default)", consulta("events", e(campo("type", "IN"), campo("created_at", "LESS_THAN_OR_EQUAL")), [("created_at", "ASCENDING"), ("__name__", "ASCENDING")]))
        self.assertEqual((forma.igualdades, forma.ordens), (("type",), (("created_at", "ASCENDING"),)))

    def test_so_igualdades_ou_uma_ordem_dispensam_o_composto(self) -> None:
        [iguais] = c.formas("(default)", consulta("faturas", e(campo("customer_code", "EQUAL"), campo("status", "IN"))))
        [ordem] = c.formas("(default)", consulta("events", None, [("occurred_at", "DESCENDING")]))
        [faixa] = c.formas("(default)", consulta("events", campo("occurred_at", "GREATER_THAN_OR_EQUAL"), [("occurred_at", "DESCENDING")]))
        self.assertFalse(any(c.precisa_de_composto(forma) for forma in (iguais, ordem, faixa)))

    def test_a_ordem_so_pelo_id_dispensa_o_composto(self) -> None:
        [forma] = c.formas("(default)", consulta("events", campo("customer_code", "EQUAL"), [("__name__", "DESCENDING")]))
        self.assertEqual(forma.ordens, (("__name__", "DESCENDING"),))
        self.assertFalse(c.precisa_de_composto(forma))

    def test_o_array_contains_pede_o_campo_em_contains(self) -> None:
        [forma] = c.formas("(default)", consulta("ai_agent_notes", campo("tags", "ARRAY_CONTAINS"), [("updated_at", "DESCENDING")]))
        self.assertEqual((forma.igualdades, forma.contem), (("tags",), ("tags",)))
        self.assertEqual(forma.para_o_arquivo()["fields"][0], {"fieldPath": "tags", "arrayConfig": "CONTAINS"})
        self.assertTrue(c.servida(forma, [indice("ai_agent_notes", ("tags", "CONTAINS"), ("updated_at", "DESCENDING"))]))
        self.assertFalse(c.servida(forma, [indice("ai_agent_notes", ("tags", "ASCENDING"), ("updated_at", "DESCENDING"))]))

    def test_cada_ramo_do_or_pede_o_seu(self) -> None:
        pedidas = c.formas("(default)", consulta("demands", ou(campo("status", "EQUAL"), campo("etapa", "EQUAL")), [("updated_at", "DESCENDING")]))
        self.assertEqual({forma.igualdades for forma in pedidas}, {("status",), ("etapa",)})

    def test_o_grupo_de_colecoes(self) -> None:
        [forma] = c.formas("(default)", consulta("aditivos", campo("contract_id", "EQUAL"), [("numero", "ASCENDING")], grupo=True))
        self.assertEqual(forma.escopo, "COLLECTION_GROUP")


class ServidaTest(unittest.TestCase):
    forma = c.Forma("(default)", "agent_messages", "COLLECTION", ("conversation_id", "customer_code"), (("created_at_iso", "DESCENDING"),))

    def test_indice_exato(self) -> None:
        self.assertTrue(c.servida(self.forma, [indice("agent_messages", ("customer_code", "ASCENDING"), ("conversation_id", "ASCENDING"), ("created_at_iso", "DESCENDING"))]))

    def test_indices_que_se_juntam(self) -> None:
        juntos = [
            indice("agent_messages", ("conversation_id", "ASCENDING"), ("created_at_iso", "DESCENDING")),
            indice("agent_messages", ("customer_code", "ASCENDING"), ("created_at_iso", "DESCENDING")),
        ]
        self.assertTrue(c.servida(self.forma, juntos))
        self.assertFalse(c.servida(self.forma, juntos[:1]))

    def test_a_direcao_e_o_escopo_contam(self) -> None:
        ao_contrario = indice("agent_messages", ("conversation_id", "ASCENDING"), ("customer_code", "ASCENDING"), ("created_at_iso", "ASCENDING"))
        de_grupo = indice("agent_messages", ("conversation_id", "ASCENDING"), ("customer_code", "ASCENDING"), ("created_at_iso", "DESCENDING"), escopo="COLLECTION_GROUP")
        self.assertFalse(c.servida(self.forma, [ao_contrario, de_grupo]))


class MainTest(unittest.TestCase):
    def raiz(self, pasta: Path) -> Path:
        (pasta / "firebase.json").write_text(
            json.dumps({"firestore": [{"database": "(default)", "indexes": "firestore.indexes.json"}, {"database": "dute-rh"}]}),
            encoding="utf-8",
        )
        (pasta / "firestore.indexes.json").write_text(
            json.dumps({"indexes": [{"collectionGroup": "events", "queryScope": "COLLECTION", "fields": [{"fieldPath": "customer_code", "order": "ASCENDING"}, {"fieldPath": "occurred_at", "order": "DESCENDING"}]}]}),
            encoding="utf-8",
        )
        return pasta

    def rodar(self, gravadas: list[dict[str, Any]] | None) -> tuple[int, str]:
        with tempfile.TemporaryDirectory() as pasta:
            raiz = self.raiz(Path(pasta))
            arquivo = raiz / "consultas.jsonl"
            if gravadas is not None:
                arquivo.write_text("".join(json.dumps(gravada) + "\n" for gravada in gravadas), encoding="utf-8")
            saida = io.StringIO()
            with redirect_stdout(saida):
                codigo = c.main([str(arquivo)], raiz=raiz)
        return codigo, saida.getvalue()

    def test_consulta_com_indice_passa(self) -> None:
        codigo, saida = self.rodar([{"banco": "(default)", "consulta": consulta("events", campo("customer_code", "EQUAL"), [("occurred_at", "DESCENDING")]), "origem": ["lib/a.js:1:1"]}])
        self.assertEqual(codigo, 0)
        self.assertIn("1 consultas gravadas, 1 formas, 1 com índice composto.", saida)

    def test_consulta_sem_indice_reprova_com_o_indice_para_o_arquivo(self) -> None:
        codigo, saida = self.rodar([{"banco": "(default)", "consulta": consulta("movements", campo("tipo_mov", "EQUAL"), [("qtd", "DESCENDING")]), "origem": ["lib/domain/x.js:10:5"]}])
        self.assertEqual(codigo, 1)
        self.assertIn("::error::Consulta sem índice: movements (tipo_mov ASCENDING, qtd DESCENDING)", saida)
        self.assertIn('"collectionGroup": "movements"', saida)
        self.assertIn("de lib/domain/x.js:10:5", saida)

    def test_banco_sem_arquivo_de_indices_nao_tem_composto(self) -> None:
        codigo, saida = self.rodar([{"banco": "dute-rh", "consulta": consulta("events", campo("customer_code", "EQUAL"), [("occurred_at", "DESCENDING")])}])
        self.assertEqual(codigo, 1)
        self.assertIn("no banco dute-rh", saida)

    def test_nada_gravado_reprova(self) -> None:
        for gravadas in (None, []):
            with self.subTest(gravadas=gravadas):
                codigo, saida = self.rodar(gravadas)
                self.assertEqual(codigo, 1)
                self.assertIn("Nenhuma consulta gravada", saida)


class WorkflowTest(unittest.TestCase):
    """Cada job de integração das Functions grava as consultas e confere o índice delas."""

    texto = (Path(__file__).resolve().parent.parent / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")

    def test_cada_job_de_integracao_grava_e_confere(self) -> None:
        jobs = re.findall(r"(?ms)^  ([a-z-]+-integration):\n(.*?)(?=^  \S|\Z)", self.texto)
        self.assertEqual(
            sorted(nome for nome, _ in jobs),
            ["comercial-integration", "core-integration", "financeiro-integration", "functions-integration", "operacao-integration", "rh-integration"],
        )
        for nome, corpo in jobs:
            with self.subTest(job=nome):
                testes = corpo.index("run: npm run test:integration")
                self.assertIn("NODE_OPTIONS: --require ${{ github.workspace }}/tools/registrar_consultas.cjs", corpo[:testes])
                self.assertIn("CONSULTAS_SAIDA: ${{ runner.temp }}/consultas.jsonl", corpo[:testes])
                self.assertIn('python3 tools/indices_das_consultas.py "${{ runner.temp }}/consultas.jsonl"', corpo[testes:])


if __name__ == "__main__":
    unittest.main()
