"""Testes de tools/esperar_ci.py contra uma API do GitHub falsa.

Rodar da raiz do repositório:

    python -m unittest discover -s tools -p "test_*.py" -v
"""

from __future__ import annotations

import re
import tempfile
import unittest
import urllib.error
from pathlib import Path
from typing import Any

import esperar_ci as e

SHA = "37327f3635dd7b3e16f36ba5e77b4078a895a046"
OUTRO = "92f6501af1acd9e9eb495f5076cce4d0f0057211"


def execucao(status: str, conclusion: str | None = None, run_id: int = 1) -> dict[str, Any]:
    return {"id": run_id, "status": status, "conclusion": conclusion, "html_url": f"https://github.com/x/y/actions/runs/{run_id}"}


class ApiFalsa:
    """Devolve uma rodada por chamada; a última se repete."""

    def __init__(self, rodadas: list[tuple[str, list[dict[str, Any]] | Exception]]):
        self.rodadas = rodadas
        self.chamadas = 0

    def _rodada(self) -> tuple[str, list[dict[str, Any]] | Exception]:
        return self.rodadas[min(self.chamadas, len(self.rodadas) - 1)]

    def head_main(self) -> str:
        return self._rodada()[0]

    def execucoes_ci(self, sha: str) -> list[dict[str, Any]]:
        assert sha == SHA
        resposta = self._rodada()[1]
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


def esperar(api: ApiFalsa, prazo_s: float = 600) -> tuple[str, dict[str, Any] | None, str | None]:
    relogio = Relogio()
    return e.esperar(api, SHA, prazo_s=prazo_s, intervalo_s=20, dormir=relogio.dormir, relogio=relogio, log=lambda _: None)


class DecidirTest(unittest.TestCase):
    def test_main_andou_cede_a_vez_mesmo_com_ci_verde(self) -> None:
        self.assertEqual(e.decidir(OUTRO, SHA, [execucao("completed", "success")])[0], "superado")

    def test_sem_execucao_ainda_espera(self) -> None:
        self.assertEqual(e.decidir(SHA, SHA, [])[0], "esperar")

    def test_ci_rodando_espera(self) -> None:
        self.assertEqual(e.decidir(SHA, SHA, [execucao("in_progress")])[0], "esperar")

    def test_ci_verde_publica(self) -> None:
        self.assertEqual(e.decidir(SHA, SHA, [execucao("completed", "success")])[0], "verde")

    def test_ci_vermelho_ou_cancelado_nao_publica(self) -> None:
        for conclusao in ("failure", "cancelled", "timed_out", "startup_failure"):
            with self.subTest(conclusao=conclusao):
                self.assertEqual(e.decidir(SHA, SHA, [execucao("completed", conclusao)])[0], "vermelho")

    def test_vale_a_execucao_mais_nova_do_commit(self) -> None:
        execucoes = [execucao("completed", "failure", run_id=10), execucao("in_progress", run_id=11)]
        self.assertEqual(e.decidir(SHA, SHA, execucoes), ("esperar", execucoes[1]))


class EsperarTest(unittest.TestCase):
    def test_espera_o_ci_aparecer_e_terminar(self) -> None:
        api = ApiFalsa([(SHA, []), (SHA, [execucao("queued")]), (SHA, [execucao("in_progress")]), (SHA, [execucao("completed", "success")])])
        self.assertEqual(esperar(api)[0], "verde")
        self.assertEqual(api.chamadas, 4)

    def test_para_de_esperar_quando_a_main_anda(self) -> None:
        api = ApiFalsa([(SHA, [execucao("in_progress")]), (OUTRO, [execucao("in_progress")])])
        decisao, _, head = esperar(api)
        self.assertEqual((decisao, head), ("superado", OUTRO))

    def test_falha_de_rede_tenta_de_novo(self) -> None:
        api = ApiFalsa([(SHA, e.ErroTransitorio("503")), (SHA, [execucao("completed", "success")])])
        self.assertEqual(esperar(api)[0], "verde")

    def test_prazo_esgotado(self) -> None:
        api = ApiFalsa([(SHA, [execucao("in_progress")])])
        self.assertEqual(esperar(api, prazo_s=60)[0], "sem_resposta")
        self.assertEqual(api.chamadas, 4)


class MainTest(unittest.TestCase):
    def rodar(self, api: Any) -> tuple[int, str]:
        with tempfile.TemporaryDirectory() as pasta:
            saida = Path(pasta) / "output"
            relogio = Relogio()
            codigo = e.main(
                env={"GITHUB_SHA": SHA, "GITHUB_OUTPUT": str(saida)},
                api=api,
                dormir=relogio.dormir,
                relogio=relogio,
                log=lambda _: None,
            )
            return codigo, saida.read_text(encoding="utf-8")

    def test_verde_publica(self) -> None:
        self.assertEqual(self.rodar(ApiFalsa([(SHA, [execucao("completed", "success")])])), (0, "publicar=true\n"))

    def test_superado_sai_verde_sem_publicar(self) -> None:
        self.assertEqual(self.rodar(ApiFalsa([(OUTRO, [])])), (0, "publicar=false\n"))

    def test_vermelho_sai_vermelho_sem_publicar(self) -> None:
        self.assertEqual(self.rodar(ApiFalsa([(SHA, [execucao("completed", "failure")])])), (1, "publicar=false\n"))

    def test_permissao_negada_falha_na_hora(self) -> None:
        negado = urllib.error.HTTPError("https://api.github.com/x", 403, "Forbidden", {}, None)
        self.assertEqual(self.rodar(ApiFalsa([(SHA, negado)])), (1, "publicar=false\n"))


class ShaParaHomologacaoTest(unittest.TestCase):
    def test_o_proprio_commit_ainda_no_head_publica(self) -> None:
        self.assertEqual(e.sha_para_homologacao(SHA, SHA, []), SHA)

    def test_head_com_ci_verde_publica_o_head_mesmo_se_o_disparo_e_antigo(self) -> None:
        self.assertEqual(
            e.sha_para_homologacao(OUTRO, SHA, [execucao("completed", "failure", run_id=1), execucao("completed", "success", run_id=2)]),
            OUTRO,
        )

    def test_head_sem_ci_ou_com_ci_aberto_ou_vermelho_nao_publica(self) -> None:
        self.assertIsNone(e.sha_para_homologacao(OUTRO, SHA, []))
        self.assertIsNone(e.sha_para_homologacao(OUTRO, SHA, [execucao("in_progress", run_id=3)]))
        self.assertIsNone(e.sha_para_homologacao(OUTRO, SHA, [execucao("completed", "failure", run_id=4)]))

    def test_head_so_de_documentacao_sem_ci_publica_o_head(self) -> None:
        # 17/11/2026: o merge do PR 621, só do diagnóstico, virou o HEAD logo depois do PR 620.
        # Pelo paths-ignore ele nunca tem CI, e a homologação do 620 saiu sem publicar.
        self.assertEqual(e.sha_para_homologacao(OUTRO, SHA, [], ["docs/plataforma/diagnostico-contagem-ciclica.md"]), OUTRO)

    def test_head_sem_ci_com_codigo_no_caminho_nao_publica(self) -> None:
        self.assertIsNone(e.sha_para_homologacao(OUTRO, SHA, [], ["docs/a.md", "functions/wms/src/index.ts"]))
        self.assertIsNone(e.sha_para_homologacao(OUTRO, SHA, [], None))

    def test_vale_a_execucao_mais_nova_do_head(self) -> None:
        self.assertIsNone(
            e.sha_para_homologacao(OUTRO, SHA, [execucao("completed", "success", run_id=1), execucao("completed", "failure", run_id=9)]),
        )


class WorkflowsTest(unittest.TestCase):
    """Trava o gatilho da homologação (incidente de 22/10/2026, sem a espera ativa)."""

    raiz = Path(__file__).resolve().parent.parent

    def ler(self, nome: str) -> str:
        return (self.raiz / ".github" / "workflows" / nome).read_text(encoding="utf-8")

    def test_homologacao_nasce_quando_o_ci_da_main_fica_verde(self) -> None:
        texto = self.ler("homologacao.yml")
        self.assertIn("workflow_run:", texto)
        self.assertIn('workflows: ["CI"]', texto)
        self.assertIn("types: [completed]", texto)
        self.assertRegex(texto, r"(?m)^concurrency:\n  group: publicar-homologacao\n  cancel-in-progress: false\n")
        self.assertIn("github.event.workflow_run.conclusion == 'success'", texto)
        self.assertIn("github.event.workflow_run.event == 'push'", texto)
        self.assertIn("github.event.workflow_run.head_branch == 'main'", texto)
        self.assertIn("python3 tools/esperar_ci.py --sha", texto)
        self.assertNotIn("\n        run: python3 tools/esperar_ci.py\n", texto)
        self.assertIn("commit_sha: ${{ needs.escolher.outputs.sha }}", texto)

    def test_ci_nao_publica_a_homologacao(self) -> None:
        self.assertNotIn("ambiente: homologacao", self.ler("ci.yml"))



class SoCaminhosQueOCiIgnoraTest(unittest.TestCase):
    def test_documentacao_e_markdown(self) -> None:
        self.assertTrue(e.so_caminhos_que_o_ci_ignora(["docs/plataforma/diagnostico-contagem-ciclica.md"]))
        self.assertTrue(e.so_caminhos_que_o_ci_ignora(["CLAUDE.md", "docs/mockups/x.dc.html", "tools/acerto-btg-2026-10/README.md"]))

    def test_codigo_ou_lista_vazia_nao(self) -> None:
        self.assertFalse(e.so_caminhos_que_o_ci_ignora(["docs/a.md", "tools/esperar_ci.py"]))
        self.assertFalse(e.so_caminhos_que_o_ci_ignora([]))

    def test_e_a_lista_do_paths_ignore_do_ci(self) -> None:
        texto = (Path(__file__).resolve().parent.parent / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        listas = re.findall(r"paths-ignore:\n((?:      - .+\n)+)", texto)
        self.assertEqual(len(listas), 2, "push e pull_request")
        for lista in listas:
            self.assertEqual(tuple(re.findall(r'- "(.+)"', lista)), e.CAMINHOS_QUE_O_CI_IGNORA)


class ArquivosEntreTest(unittest.TestCase):
    class GitHubFalso(e.GitHub):
        def __init__(self, resposta: dict[str, Any]):
            super().__init__("dono/repo", "token")
            self.resposta = resposta
            self.caminhos: list[str] = []

        def _get(self, caminho: str) -> Any:
            self.caminhos.append(caminho)
            return self.resposta

    def test_lista_os_arquivos_com_o_nome_antigo_dos_renomeados(self) -> None:
        api = self.GitHubFalso(
            {"status": "ahead", "files": [{"filename": "docs/a.md"}, {"filename": "docs/b.py", "previous_filename": "tools/b.py"}]}
        )
        self.assertEqual(api.arquivos_entre(SHA, OUTRO), ["docs/a.md", "docs/b.py", "tools/b.py"])
        self.assertEqual(api.caminhos, [f"/repos/dono/repo/compare/{SHA}...{OUTRO}"])

    def test_head_que_nao_descende_ou_lista_cortada_vira_none(self) -> None:
        self.assertIsNone(self.GitHubFalso({"status": "diverged", "files": [{"filename": "docs/a.md"}]}).arquivos_entre(SHA, OUTRO))
        cheia = {"status": "ahead", "files": [{"filename": f"docs/{n}.md"} for n in range(300)]}
        self.assertIsNone(self.GitHubFalso(cheia).arquivos_entre(SHA, OUTRO))


class ApiDoSha:
    def __init__(self, head: str, execucoes: list[dict[str, Any]], arquivos: list[str] | None | Exception = None):
        self.head = head
        self.execucoes = execucoes
        self.arquivos = arquivos
        self.comparacoes: list[tuple[str, str]] = []

    def head_main(self) -> str:
        return self.head

    def execucoes_ci(self, sha: str) -> list[dict[str, Any]]:
        assert sha == self.head
        return self.execucoes

    def arquivos_entre(self, base: str, head: str) -> list[str] | None:
        self.comparacoes.append((base, head))
        if isinstance(self.arquivos, Exception):
            raise self.arquivos
        return self.arquivos


class MainShaTest(unittest.TestCase):
    def rodar(self, api: Any) -> tuple[int, str]:
        with tempfile.TemporaryDirectory() as pasta:
            saida = Path(pasta) / "output"
            codigo = e.main_sha(env={"CI_SHA": SHA, "GITHUB_OUTPUT": str(saida)}, api=api)
            return codigo, saida.read_text(encoding="utf-8")

    def test_ainda_no_head_publica_sem_comparar(self) -> None:
        api = ApiDoSha(SHA, [])
        self.assertEqual(self.rodar(api), (0, f"sha={SHA}\n"))
        self.assertEqual(api.comparacoes, [])

    def test_head_so_de_documentacao_sem_ci_publica_o_head(self) -> None:
        api = ApiDoSha(OUTRO, [], ["docs/plataforma/diagnostico-contagem-ciclica.md"])
        self.assertEqual(self.rodar(api), (0, f"sha={OUTRO}\n"))
        self.assertEqual(api.comparacoes, [(SHA, OUTRO)])

    def test_head_com_codigo_sem_ci_ainda_fica_para_o_ci_dele(self) -> None:
        self.assertEqual(self.rodar(ApiDoSha(OUTRO, [], ["functions/wms/src/index.ts"])), (0, "sha=\n"))

    def test_head_com_ci_nao_compara(self) -> None:
        api = ApiDoSha(OUTRO, [execucao("in_progress")])
        self.assertEqual(self.rodar(api), (0, "sha=\n"))
        self.assertEqual(api.comparacoes, [])

    def test_falha_na_comparacao_nao_publica(self) -> None:
        self.assertEqual(self.rodar(ApiDoSha(OUTRO, [], e.ErroTransitorio("502"))), (1, "sha=\n"))


if __name__ == "__main__":
    unittest.main()
