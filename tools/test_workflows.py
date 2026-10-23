"""Travas no texto dos workflows do GitHub Actions.

Rodar da raiz do repositório:

    python -m unittest discover -s tools -p "test_*.py" -v
"""

from __future__ import annotations

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


if __name__ == "__main__":
    unittest.main()
