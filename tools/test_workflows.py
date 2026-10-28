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


class TesteRestauracaoTest(unittest.TestCase):
    """O teste-restauracao.yml cria e apaga banco na produção: só por disparo manual."""

    def setUp(self) -> None:
        self.texto = (WORKFLOWS / "teste-restauracao.yml").read_text(encoding="utf-8")

    def test_so_roda_por_disparo_manual(self) -> None:
        gatilhos = re.search(r"^on:\n((?:  .*\n)+)", self.texto, re.MULTILINE)
        assert gatilhos is not None
        self.assertEqual(re.findall(r"^  (\w+):", gatilhos.group(1), re.MULTILINE), ["workflow_dispatch"])

    def test_o_projeto_e_o_da_producao(self) -> None:
        # O backup só existe na produção; o número vai no provedor do Workload Identity.
        producao = re.search(r"project_id: (\S+)\n\s+project_number: \"(\d+)\"", (WORKFLOWS / "ci.yml").read_text(encoding="utf-8"))
        assert producao is not None
        self.assertIn(f"PROJECT_ID: {producao.group(1)}\n", self.texto)
        self.assertIn(f'PROJECT_NUMBER: "{producao.group(2)}"\n', self.texto)

    def test_os_bancos_sao_os_da_ferramenta(self) -> None:
        import teste_restauracao

        opcoes = re.search(r"      banco:\n(?:        .*\n)*?        options:\n((?:          - .*\n)+)", self.texto)
        assert opcoes is not None
        self.assertEqual(
            [opcao.strip().removeprefix("- ").strip('"') for opcao in opcoes.group(1).splitlines()],
            list(teste_restauracao.BANCOS),
        )

    def test_a_entrada_vai_por_variavel_e_nunca_no_comando(self) -> None:
        self.assertIn("BANCO: ${{ inputs.banco }}", self.texto)
        comandos = [linha for linha in self.texto.splitlines() if linha.strip().startswith("run:")]
        self.assertEqual(
            comandos,
            [
                '        run: python3 tools/teste_restauracao.py --projeto "${PROJECT_ID}" --banco "${BANCO}"'
                ' ${EXECUTAR} --resumo "${GITHUB_STEP_SUMMARY}"'
            ],
        )

    def test_usa_a_conta_das_functions(self) -> None:
        self.assertIn("service_account: github-actions-functions@${{ env.PROJECT_ID }}.iam.gserviceaccount.com", self.texto)


class WmsIntegrationEmulatorsTest(unittest.TestCase):
    def test_reconvite_inicia_auth_local_sem_credenciais_reais(self) -> None:
        import json
        root = WORKFLOWS.parent.parent
        config = json.loads((root / "firebase.json").read_text(encoding="utf-8"))
        auth = config["emulators"].get("auth")
        self.assertIsNotNone(auth, "O reconvite exige o emulador Auth declarado, não só --only auth.")
        self.assertEqual(auth["host"], "127.0.0.1")
        self.assertNotEqual(auth["port"], config["emulators"]["storage"]["port"])
        script = json.loads((root / "functions/wms/package.json").read_text(encoding="utf-8"))["scripts"]["test:integration"]
        emuladores = re.search(r"--only ([^ ]+)", script)
        self.assertIsNotNone(emuladores)
        self.assertIn("auth", emuladores.group(1).split(","))


if __name__ == "__main__":
    unittest.main()
