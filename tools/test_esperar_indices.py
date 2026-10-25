"""Testes de tools/esperar_indices.py contra uma API do Firestore falsa.

Rodar da raiz do repositório:

    python -m unittest discover -s tools -p "test_*.py" -v
"""

from __future__ import annotations

import io
import re
import unittest
import urllib.error
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any

import esperar_indices as e

MOVIMENTOS: e.Chave = ("movements", "COLLECTION", (("tipo_mov", "ASCENDING"), ("cod_sku", "ASCENDING")))
EVENTOS: e.Chave = ("events", "COLLECTION", (("type", "ASCENDING"), ("created_at", "ASCENDING")))


def da_api(indice: e.Chave, estado: str) -> dict[str, Any]:
    """Como a API lista: o nome com a coleção e o __name__ no fim, na direção do último campo."""
    colecao, escopo, campos = indice
    return {
        "name": f"projects/p/databases/(default)/collectionGroups/{colecao}/indexes/CICAgJim14AK",
        "queryScope": escopo,
        "fields": [{"fieldPath": campo, "order": ordem} for campo, ordem in campos] + [{"fieldPath": "__name__", "order": campos[-1][1]}],
        "state": estado,
    }


class ApiFalsa:
    """Devolve uma rodada por chamada; a última se repete."""

    def __init__(self, rodadas: list[list[dict[str, Any]] | Exception]):
        self.rodadas = rodadas
        self.chamadas = 0

    def indices(self) -> list[dict[str, Any]]:
        resposta = self.rodadas[min(self.chamadas, len(self.rodadas) - 1)]
        self.chamadas += 1
        if isinstance(resposta, Exception):
            raise resposta
        return resposta


class Relogio:
    def __init__(self) -> None:
        self.agora = 0.0

    def __call__(self) -> float:
        return self.agora

    def dormir(self, segundos: float) -> None:
        self.agora += segundos


def esperar(api: ApiFalsa, esperados: list[e.Chave], prazo_s: float = 600) -> tuple[str, list[str]]:
    relogio = Relogio()
    return e.esperar(api, esperados, prazo_s=prazo_s, intervalo_s=15, dormir=relogio.dormir, relogio=relogio, log=lambda _: None)


class ArquivoTest(unittest.TestCase):
    def test_le_cada_indice_do_arquivo(self) -> None:
        esperados = e.indices_do_arquivo()
        self.assertGreater(len(esperados), 0)
        self.assertIn(EVENTOS, esperados)
        for colecao, escopo, campos in esperados:
            with self.subTest(colecao=colecao, campos=campos):
                self.assertTrue(colecao)
                self.assertEqual(escopo, "COLLECTION")
                self.assertTrue(all(campo != "__name__" and ordem for campo, ordem in campos))

    def test_o_indice_da_api_e_o_do_arquivo_sem_o_name_do_fim(self) -> None:
        self.assertEqual(e.chave_da_api(da_api(MOVIMENTOS, "READY")), MOVIMENTOS)


class DecidirTest(unittest.TestCase):
    def test_todos_prontos(self) -> None:
        self.assertEqual(e.decidir([MOVIMENTOS, EVENTOS], [da_api(MOVIMENTOS, "READY"), da_api(EVENTOS, "READY")]), ("pronto", []))

    def test_o_que_constroi_espera(self) -> None:
        decisao, pendentes = e.decidir([MOVIMENTOS, EVENTOS], [da_api(MOVIMENTOS, "CREATING"), da_api(EVENTOS, "READY")])
        self.assertEqual(decisao, "esperar")
        self.assertEqual(pendentes, ["movements (tipo_mov ASCENDING, cod_sku ASCENDING): CREATING"])

    def test_o_que_nao_aparece_ainda_espera(self) -> None:
        decisao, pendentes = e.decidir([MOVIMENTOS], [da_api(EVENTOS, "READY")])
        self.assertEqual(decisao, "esperar")
        self.assertEqual(pendentes, ["movements (tipo_mov ASCENDING, cod_sku ASCENDING): não aparece no projeto"])

    def test_a_direcao_conta(self) -> None:
        ao_contrario: e.Chave = ("movements", "COLLECTION", (("tipo_mov", "ASCENDING"), ("cod_sku", "DESCENDING")))
        self.assertEqual(e.decidir([MOVIMENTOS], [da_api(ao_contrario, "READY")])[0], "esperar")

    def test_indice_do_projeto_fora_do_arquivo_nao_conta(self) -> None:
        self.assertEqual(e.decidir([MOVIMENTOS], [da_api(MOVIMENTOS, "READY"), da_api(EVENTOS, "CREATING")]), ("pronto", []))

    def test_o_que_precisa_de_reparo_para(self) -> None:
        self.assertEqual(e.decidir([MOVIMENTOS], [da_api(MOVIMENTOS, "NEEDS_REPAIR")])[0], "reparo")


class EsperarTest(unittest.TestCase):
    def test_espera_o_indice_novo_ficar_pronto(self) -> None:
        api = ApiFalsa([[], [da_api(MOVIMENTOS, "CREATING")], [da_api(MOVIMENTOS, "READY")]])
        self.assertEqual(esperar(api, [MOVIMENTOS]), ("pronto", []))
        self.assertEqual(api.chamadas, 3)

    def test_falha_de_rede_tenta_de_novo(self) -> None:
        api = ApiFalsa([e.ErroTransitorio("503"), [da_api(MOVIMENTOS, "READY")]])
        self.assertEqual(esperar(api, [MOVIMENTOS])[0], "pronto")

    def test_prazo_esgotado(self) -> None:
        api = ApiFalsa([[da_api(MOVIMENTOS, "CREATING")]])
        decisao, pendentes = esperar(api, [MOVIMENTOS], prazo_s=60)
        self.assertEqual(decisao, "sem_resposta")
        self.assertEqual(pendentes, ["movements (tipo_mov ASCENDING, cod_sku ASCENDING): CREATING"])
        self.assertEqual(api.chamadas, 5)


class MainTest(unittest.TestCase):
    def rodar(self, api: Any) -> tuple[int, str]:
        relogio = Relogio()
        saida = io.StringIO()
        with redirect_stdout(saida):
            codigo = e.main(["dute-homolog"], env={"PRAZO_MINUTOS": "1"}, api=api, dormir=relogio.dormir, relogio=relogio, log=lambda _: None)
        return codigo, saida.getvalue()

    def pronto(self) -> list[dict[str, Any]]:
        return [da_api(indice, "READY") for indice in e.indices_do_arquivo()]

    def test_todos_os_do_arquivo_prontos(self) -> None:
        codigo, saida = self.rodar(ApiFalsa([self.pronto()]))
        self.assertEqual(codigo, 0)
        self.assertIn("estão prontos em dute-homolog", saida)

    def test_um_construindo_no_fim_do_prazo_para_a_publicacao(self) -> None:
        construindo = [da_api(EVENTOS, "CREATING") if e.chave_da_api(indice) == EVENTOS else indice for indice in self.pronto()]
        codigo, saida = self.rodar(ApiFalsa([construindo]))
        self.assertEqual(codigo, 1)
        self.assertIn("::error::Os índices não ficaram prontos em 1 min em dute-homolog", saida)
        self.assertIn("events (type ASCENDING, created_at ASCENDING): CREATING", saida)

    def test_permissao_negada_falha_na_hora(self) -> None:
        negado = urllib.error.HTTPError("https://firestore.googleapis.com/v1/x", 403, "Forbidden", {}, None)
        codigo, saida = self.rodar(ApiFalsa([negado]))
        self.assertEqual(codigo, 1)
        self.assertIn("datastore.indexes.list", saida)


class WorkflowTest(unittest.TestCase):
    """O job regras espera os índices, e as functions e o frontend vêm depois dele."""

    texto = (Path(__file__).resolve().parent.parent / ".github" / "workflows" / "publicar.yml").read_text(encoding="utf-8")

    def job(self, nome: str) -> str:
        achado = re.search(rf"(?ms)^  {nome}:\n(.*?)(?=^  \S|\Z)", self.texto)
        assert achado is not None, nome
        return achado.group(1)

    def test_o_job_regras_espera_os_indices_depois_do_deploy(self) -> None:
        regras = self.job("regras")
        deploy = regras.index("firebase deploy --only firestore,storage")
        espera = regras.index('python3 tools/esperar_indices.py "${PROJECT_ID}"')
        self.assertLess(deploy, espera)
        self.assertIn("ACCESS_TOKEN: ${{ steps.auth.outputs.access_token }}", regras[deploy:])

    def test_functions_e_frontend_dependem_das_regras(self) -> None:
        self.assertIn("needs: regras", self.job("functions"))
        self.assertIn("needs: [regras, functions]", self.job("frontend"))


if __name__ == "__main__":
    unittest.main()
