"""Travas no texto dos workflows do GitHub Actions.

Rodar da raiz do repositório:

    python -m unittest discover -s tools -p "test_*.py" -v
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / ".github" / "workflows"


class ChromiumTest(unittest.TestCase):
    def test_playwright_instala_so_o_chromium(self) -> None:
        # Em 22/10/2026 o --with-deps levou 12 min baixando pelo apt fontes e
        # xvfb que o teste headless não usa; o runner já tem as bibliotecas.
        for workflow in sorted(WORKFLOWS.glob("*.yml")):
            comandos = [
                linha
                for linha in workflow.read_text(encoding="utf-8").splitlines()
                if "playwright" in linha and not linha.lstrip().startswith("#")
            ]
            with self.subTest(workflow=workflow.name):
                self.assertFalse([linha for linha in comandos if "--with-deps" in linha or "install-deps" in linha])

    def test_os_dois_testes_de_login_continuam_instalando_o_chromium(self) -> None:
        for nome in ("ci.yml", "publicar.yml"):
            with self.subTest(workflow=nome):
                self.assertIn("playwright/cli.js\" install chromium", (WORKFLOWS / nome).read_text(encoding="utf-8"))


class BancoRhTest(unittest.TestCase):
    """O banco-rh.yml cria banco: só por disparo manual, nos projetos da publicação."""

    def setUp(self) -> None:
        self.texto = (WORKFLOWS / "banco-rh.yml").read_text(encoding="utf-8")

    def test_so_roda_por_disparo_manual(self) -> None:
        gatilhos = re.search(r"^on:\n((?:  .*\n)+)", self.texto, re.MULTILINE)
        assert gatilhos is not None
        self.assertEqual(re.findall(r"^  (\w+):", gatilhos.group(1), re.MULTILINE), ["workflow_dispatch"])

    def test_os_projetos_sao_os_da_publicacao(self) -> None:
        # O número do projeto vai no provedor do Workload Identity; trocado,
        # o login do job cai em outro projeto ou falha.
        publicados = {}
        for nome, ambiente in (("homologacao.yml", "homologacao"), ("ci.yml", "producao")):
            texto = (WORKFLOWS / nome).read_text(encoding="utf-8")
            projeto = re.search(r"project_id: (\S+)\n\s+project_number: \"(\d+)\"", texto)
            assert projeto is not None
            publicados[ambiente] = projeto.groups()
        self.assertIn(f"inputs.ambiente == 'producao' && '{publicados['producao'][0]}' || '{publicados['homologacao'][0]}'", self.texto)
        self.assertIn(f"inputs.ambiente == 'producao' && '{publicados['producao'][1]}' || '{publicados['homologacao'][1]}'", self.texto)

    def test_usa_a_conta_das_functions_e_o_script(self) -> None:
        self.assertIn("service_account: github-actions-functions@${{ env.PROJECT_ID }}.iam.gserviceaccount.com", self.texto)
        self.assertIn('run: bash tools/banco_rh.sh "${PROJECT_ID}"', self.texto)


if __name__ == "__main__":
    unittest.main()
