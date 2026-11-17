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

    def test_vale_a_execucao_mais_nova_do_head(self) -> None:
        self.assertIsNone(
            e.sha_para_homologacao(OUTRO, SHA, [execucao("completed", "success", run_id=1), execucao("completed", "failure", run_id=9)]),
        )


class SoOQueOCiIgnoraTest(unittest.TestCase):
    """O push que só muda o que o CI ignora (docs/**, **/*.md) nunca ganha CI: o HEAD dele sobe pelo CI verde de antes."""

    def test_docs_e_markdown_em_qualquer_pasta(self) -> None:
        self.assertTrue(e.so_o_que_o_ci_ignora(["docs/plataforma/diagnostico.md", "docs/mockups/Tela.dc.html", "README.md", "tools/acerto/README.md"]))

    def test_qualquer_outro_arquivo_conta(self) -> None:
        self.assertFalse(e.so_o_que_o_ci_ignora(["docs/plataforma/diagnostico.md", "tools/esperar_ci.py"]))
        self.assertFalse(e.so_o_que_o_ci_ignora([".github/workflows/ci.yml"]))
        # O filtro do GitHub diferencia maiúscula: README.MD não é *.md.
        self.assertFalse(e.so_o_que_o_ci_ignora(["README.MD"]))
        self.assertFalse(e.so_o_que_o_ci_ignora(["documentos/a.md.bak"]))

    def test_sem_arquivos_ou_sem_a_comparacao_nao_publica(self) -> None:
        self.assertFalse(e.so_o_que_o_ci_ignora([]))
        self.assertFalse(e.so_o_que_o_ci_ignora(None))


class HeadSoDeDocsTest(unittest.TestCase):
    """Incidente de 17/11/2026: o #621, só de docs, virou o HEAD antes de o CI do #620 acabar, e o #620 não subiu."""

    def test_head_sem_ci_que_so_mudou_docs_publica_o_head(self) -> None:
        self.assertEqual(e.sha_para_homologacao(OUTRO, SHA, [], ["docs/plataforma/diagnostico-contagem-ciclica.md"]), OUTRO)

    def test_head_sem_ci_com_codigo_espera_o_ci_dele(self) -> None:
        self.assertIsNone(e.sha_para_homologacao(OUTRO, SHA, [], ["docs/a.md", "functions/wms/src/index.ts"]))
        self.assertIsNone(e.sha_para_homologacao(OUTRO, SHA, [], None))

    def test_head_com_ci_proprio_decide_pelo_ci_dele(self) -> None:
        self.assertIsNone(e.sha_para_homologacao(OUTRO, SHA, [execucao("in_progress", run_id=3)], ["docs/a.md"]))


class GitHubFalso(e.GitHub):
    def __init__(self, respostas: dict[str, Any]):
        super().__init__("Leow4u/Dute", "token")
        self.respostas = respostas
        self.caminhos: list[str] = []

    def _get(self, caminho: str) -> Any:
        self.caminhos.append(caminho)
        for prefixo, resposta in self.respostas.items():
            if caminho.startswith(prefixo):
                if isinstance(resposta, Exception):
                    raise resposta
                return resposta
        raise AssertionError(f"caminho inesperado: {caminho}")


class ArquivosEntreTest(unittest.TestCase):
    def comparar(self, resposta: dict[str, Any]) -> list[str] | None:
        return GitHubFalso({"/repos/Leow4u/Dute/compare/": resposta}).arquivos_entre(SHA, OUTRO)

    def test_o_head_a_frente_devolve_os_arquivos(self) -> None:
        api = GitHubFalso({"/repos/Leow4u/Dute/compare/": {"status": "ahead", "files": [{"filename": "docs/a.md"}, {"filename": "README.md"}]}})
        self.assertEqual(api.arquivos_entre(SHA, OUTRO), ["docs/a.md", "README.md"])
        self.assertEqual(api.caminhos, [f"/repos/Leow4u/Dute/compare/{SHA}...{OUTRO}"])

    def test_historia_que_nao_e_avanco_ou_lista_cortada_nao_serve(self) -> None:
        for status in ("diverged", "behind", "identical"):
            with self.subTest(status=status):
                self.assertIsNone(self.comparar({"status": status, "files": [{"filename": "docs/a.md"}]}))
        # A comparação do GitHub para em 300 arquivos: a lista pode estar cortada.
        self.assertIsNone(self.comparar({"status": "ahead", "files": [{"filename": f"docs/{n}.md"} for n in range(300)]}))
        self.assertIsNone(self.comparar({"status": "ahead"}))


class MainShaTest(unittest.TestCase):
    def rodar(self, respostas: dict[str, Any]) -> tuple[int, str]:
        with tempfile.TemporaryDirectory() as pasta:
            saida = Path(pasta) / "output"
            codigo = e.main_sha(env={"CI_SHA": SHA, "GITHUB_OUTPUT": str(saida)}, api=GitHubFalso(respostas))
            return codigo, saida.read_text(encoding="utf-8")

    def respostas(self, arquivos: list[str], execucoes: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        return {
            "/repos/Leow4u/Dute/git/ref/heads/main": {"object": {"sha": OUTRO}},
            "/repos/Leow4u/Dute/actions/workflows/ci.yml/runs": {"workflow_runs": execucoes or []},
            "/repos/Leow4u/Dute/compare/": {"status": "ahead", "files": [{"filename": nome} for nome in arquivos]},
        }

    def test_head_so_de_docs_sobe(self) -> None:
        self.assertEqual(self.rodar(self.respostas(["docs/plataforma/diagnostico-contagem-ciclica.md"])), (0, f"sha={OUTRO}\n"))

    def test_head_com_codigo_sem_ci_ainda_nao_sobe(self) -> None:
        self.assertEqual(self.rodar(self.respostas(["tools/esperar_ci.py"])), (0, "sha=\n"))

    def test_head_com_ci_verde_sobe_sem_comparar(self) -> None:
        respostas = self.respostas(["tools/esperar_ci.py"], [execucao("completed", "success", run_id=7)])
        respostas["/repos/Leow4u/Dute/compare/"] = AssertionError("não compara quando o HEAD tem CI")
        self.assertEqual(self.rodar(respostas), (0, f"sha={OUTRO}\n"))

    def test_falha_de_rede_na_comparacao_nao_sobe(self) -> None:
        respostas = self.respostas([])
        respostas["/repos/Leow4u/Dute/compare/"] = e.ErroTransitorio("502")
        self.assertEqual(self.rodar(respostas), (1, "sha=\n"))


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

    def test_o_que_o_ci_ignora_no_push_e_o_que_esperar_ci_conhece(self) -> None:
        texto = self.ler("ci.yml")
        bloco = re.search(r"(?m)^  push:\n(?:    .*\n)*?    paths-ignore:\n((?:      - .*\n)+)", texto)
        self.assertIsNotNone(bloco, "o push do ci.yml sem paths-ignore")
        padroes = tuple(linha.strip()[2:].strip().strip('"') for linha in bloco.group(1).splitlines())
        self.assertEqual(padroes, e.IGNORADOS_PELO_CI)


if __name__ == "__main__":
    unittest.main()
