"""Testes de tools/fechar_avisos_antigos.py contra um Firestore falso.

Rodar da raiz do repositório:

    python -m unittest discover -s tools -p "test_*.py" -v
"""

from __future__ import annotations

import contextlib
import io
import unittest
from typing import Any
from unittest import mock

import fechar_avisos_antigos
from reset_btg_inventory import decode_document, firestore_value


PROJECT = "dute-prod"
PREFIX = f"projects/{PROJECT}/databases/(default)/documents/ai_agent_inbox/"


def aviso(aviso_id: str, fields: dict[str, Any], update_time: str = "2026-11-03T22:00:00.000000Z") -> dict[str, Any]:
    return {
        "name": f"{PREFIX}{aviso_id}",
        "fields": {key: firestore_value(value) for key, value in fields.items()},
        "updateTime": update_time,
    }


AVISOS = [
    aviso("inbox_evt_b", {"status": "open", "title": "Conferência de recebimento salva", "customer_code": "BTG", "created_at": "2026-11-03T19:00:00Z"}),
    aviso("inbox_evt_a", {"status": "open", "title": "Pedido criado a partir do portal", "customer_code": "BTG", "created_at": "2026-11-02T10:00:00Z"}),
    aviso("inbox_evt_c", {"status": "resolved", "title": "Já resolvido", "customer_code": "BTG"}),
    # Sem status: o painel antigo o mostrava como aberto.
    aviso("doc_action_1", {"title": "Tratar documento: NF 48.301", "customer_code": "BTG", "created_at": "2026-11-01T08:00:00Z"}),
]


class FecharAvisosAntigosTest(unittest.TestCase):
    def rodar(self, argv: list[str], documentos: list[dict[str, Any]] | None = None):
        lotes: list[list[dict[str, Any]]] = []
        saida = io.StringIO()

        def batch_write(writes: list[dict[str, Any]], *, project_id: str, database: str, token: str) -> None:
            self.assertEqual((project_id, database, token), (PROJECT, "(default)", "token"))
            lotes.append(writes)

        with mock.patch.object(fechar_avisos_antigos, "access_token", return_value="token"), mock.patch.object(
            fechar_avisos_antigos, "fetch_collection_raw", return_value=AVISOS if documentos is None else documentos
        ) as leitura, mock.patch.object(fechar_avisos_antigos, "batch_write", batch_write), mock.patch.object(
            fechar_avisos_antigos, "conta_do_gcloud", return_value="leonardo@dutelog.com.br"
        ), contextlib.redirect_stdout(saida):
            codigo = fechar_avisos_antigos.main(argv)
        if leitura.call_count:
            leitura.assert_called_once_with("ai_agent_inbox", project_id=PROJECT, database="(default)", token="token")
        return codigo, saida.getvalue(), lotes

    def test_sem_apply_so_lista_os_abertos_do_mais_antigo_e_nao_grava(self) -> None:
        codigo, saida, lotes = self.rodar(["--project-id", PROJECT])
        self.assertEqual(codigo, 0)
        self.assertEqual(lotes, [])
        self.assertIn("3 aviso(s) aberto(s) em ai_agent_inbox de dute-prod/(default).", saida)
        linhas = [linha for linha in saida.splitlines() if linha.startswith("- ")]
        self.assertEqual([linha.split(" · ")[0] for linha in linhas], ["- doc_action_1", "- inbox_evt_a", "- inbox_evt_b"])
        self.assertNotIn("inbox_evt_c", saida)
        self.assertIn("Nada foi gravado.", saida)

    def test_com_apply_resolve_cada_aberto_como_o_painel_antigo_com_a_precondicao(self) -> None:
        codigo, saida, lotes = self.rodar(["--project-id", PROJECT, "--apply"])
        self.assertEqual(codigo, 0)
        self.assertEqual(len(lotes), 1)
        escritas = lotes[0]
        self.assertEqual([escrita["update"]["name"].rsplit("/", 1)[-1] for escrita in escritas], ["doc_action_1", "inbox_evt_a", "inbox_evt_b"])
        for escrita in escritas:
            self.assertEqual(escrita["updateMask"], {"fieldPaths": ["resolution", "resolved_by", "status"]})
            self.assertEqual(
                escrita["updateTransforms"],
                [
                    {"fieldPath": "resolved_at", "setToServerValue": "REQUEST_TIME"},
                    {"fieldPath": "updated_at", "setToServerValue": "REQUEST_TIME"},
                ],
            )
            self.assertEqual(escrita["currentDocument"], {"updateTime": "2026-11-03T22:00:00.000000Z"})
            gravado = decode_document(escrita["update"])
            self.assertEqual(gravado["status"], "resolved")
            self.assertEqual(
                gravado["resolved_by"],
                {"uid": "tools/fechar_avisos_antigos.py", "email": "leonardo@dutelog.com.br", "name": "Fechamento dos avisos antigos", "role": "script"},
            )
            self.assertIn("04/11/2026", gravado["resolution"])
            # Só o que o "Resolver" muda: o título, o cliente e a origem ficam.
            self.assertNotIn("title", gravado)
        self.assertIn("3 aviso(s) fechado(s).", saida)

    def test_sem_aviso_aberto_nao_grava(self) -> None:
        codigo, saida, lotes = self.rodar(["--project-id", PROJECT, "--apply"], documentos=[AVISOS[2]])
        self.assertEqual(codigo, 0)
        self.assertEqual(lotes, [])
        self.assertIn("0 aviso(s) aberto(s)", saida)

    def test_so_onde_o_agente_do_nucleo_roda(self) -> None:
        for projeto in ("dute-btg", "outro"):
            with self.subTest(projeto=projeto), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                fechar_avisos_antigos.parser().parse_args(["--project-id", projeto])
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            fechar_avisos_antigos.parser().parse_args([])
        self.assertEqual(fechar_avisos_antigos.PROJECTS, ("dute-homolog", "dute-prod"))

    def test_os_projetos_sao_os_do_agente_do_nucleo(self) -> None:
        from pathlib import Path
        import re

        fonte = (Path(__file__).resolve().parent.parent / "functions/wms/src/domain/agent-routines.ts").read_text(encoding="utf-8")
        lista = re.search(r"CORE_AGENT_PROJECTS = \[([^\]]*)\]", fonte)
        self.assertIsNotNone(lista)
        self.assertEqual(tuple(re.findall(r'"([^"]+)"', lista.group(1))), fechar_avisos_antigos.PROJECTS)


if __name__ == "__main__":
    unittest.main()
