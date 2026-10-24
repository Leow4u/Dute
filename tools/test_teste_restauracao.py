"""Testes de tools/teste_restauracao.py com um gcloud e um Firestore falsos.

Rodar da raiz do repositório:

    python -m unittest discover -s tools -p "test_*.py" -v
"""

from __future__ import annotations

import contextlib
import io
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import teste_restauracao as t


PROJETO = "dute-prod"
AGORA = datetime(2026, 10, 25, 10, 15, 0, tzinfo=timezone.utc)
SNAPSHOT = "2026-10-25T04:12:37.123456789Z"
MINUTO = "2026-10-25T04:12:00Z"
SEGUINTE = "2026-10-25T04:13:00Z"
TESTE = "teste-restauracao-default-20261025t101500"


def backup(nome: str, banco: str = "(default)", snapshot: str = SNAPSHOT, estado: str = "READY") -> dict[str, Any]:
    return {
        "name": f"projects/{PROJETO}/locations/southamerica-east1/backups/{nome}",
        "database": f"projects/{PROJETO}/databases/{banco}",
        "snapshotTime": snapshot,
        "state": estado,
    }


class Relogio:
    def __init__(self, agora: datetime = AGORA):
        self.agora = agora

    def __call__(self) -> datetime:
        return self.agora

    def esperar(self, segundos: float) -> None:
        self.agora += timedelta(seconds=segundos)


class GcloudFalso:
    """Backups, bancos e operações de um projeto, com a restauração assíncrona."""

    def __init__(
        self,
        *,
        backups: list[dict[str, Any]],
        conteudo_do_backup: dict[str, set[str]] | None = None,
        bancos: list[str] | None = None,
        consultas_ate_terminar: int = 2,
        erro_da_restauracao: dict[str, Any] | None = None,
        nunca_termina: bool = False,
        falhar: dict[str, str] | None = None,
    ):
        self.backups = backups
        self.conteudo_do_backup = conteudo_do_backup or {}
        self.bancos: dict[str, set[str]] = {nome: set() for nome in (bancos or ["(default)", "dute-rh"])}
        self.consultas_ate_terminar = consultas_ate_terminar
        self.erro_da_restauracao = erro_da_restauracao
        self.nunca_termina = nunca_termina
        self.falhar = falhar or {}
        self.chamadas: list[list[str]] = []
        self.operacoes: dict[str, dict[str, Any]] = {}

    def __call__(self, argumentos: list[str]) -> Any:
        self.chamadas.append(argumentos)
        comando = " ".join(argumentos[:3])
        if comando in self.falhar:
            raise t.erro_do_gcloud(argumentos, self.falhar[comando])
        opcoes = dict(argumento[2:].split("=", 1) for argumento in argumentos if argumento.startswith("--") and "=" in argumento)
        assert opcoes.get("project") == PROJETO, argumentos
        if comando == "firestore backups list":
            return self.backups
        if comando == "firestore databases list":
            return [{"name": f"projects/{PROJETO}/databases/{nome}"} for nome in self.bancos]
        if comando == "firestore databases restore":
            destino = opcoes["destination-database"]
            if destino in self.bancos:
                raise t.erro_do_gcloud(argumentos, "ALREADY_EXISTS: database exists")
            self.bancos[destino] = set()
            nome = f"projects/{PROJETO}/databases/{destino}/operations/op-1"
            self.operacoes[nome] = {"backup": opcoes["source-backup"], "destino": destino, "consultas": 0}
            return {"name": nome, "metadata": {"operationState": "PROCESSING"}}
        if comando == "firestore operations describe":
            operacao = self.operacoes[argumentos[3]]
            assert opcoes["database"] == operacao["destino"]
            operacao["consultas"] += 1
            if self.nunca_termina or operacao["consultas"] < self.consultas_ate_terminar:
                return {"name": argumentos[3], "metadata": {"operationState": "PROCESSING"}}
            if self.erro_da_restauracao:
                return {"name": argumentos[3], "done": True, "error": self.erro_da_restauracao}
            self.bancos[operacao["destino"]] = set(self.conteudo_do_backup[operacao["backup"]])
            return {"name": argumentos[3], "done": True, "response": {}}
        if comando == "firestore databases delete":
            assert "--quiet" in argumentos
            del self.bancos[opcoes["database"]]
            return {}
        raise AssertionError(f"comando inesperado: {argumentos}")

    def apagados(self) -> list[str]:
        return [
            argumento.split("=", 1)[1]
            for chamada in self.chamadas
            if chamada[:3] == ["firestore", "databases", "delete"]
            for argumento in chamada
            if argumento.startswith("--database=")
        ]


class FirestoreFalso:
    """runQuery só de chaves: a origem por readTime, o banco de teste pelo gcloud falso."""

    def __init__(self, gcloud: GcloudFalso, relogio: Relogio, origem: dict[str, set[str]], banco: str = "(default)"):
        self.gcloud = gcloud
        self.relogio = relogio
        self.origem = origem
        self.banco = banco
        self.consultas: list[tuple[str, str | None]] = []

    def __call__(self, url: str, payload: dict[str, Any] | None) -> Any:
        assert url.endswith("/documents:runQuery"), url
        banco = url.split("/databases/", 1)[1].split("/documents", 1)[0]
        consulta = (payload or {})["structuredQuery"]
        # A trava da ferramenta: só o caminho sai do Firestore, nunca um campo.
        assert consulta.get("select") == {"fields": [{"fieldPath": "__name__"}]}, consulta
        read_time = (payload or {}).get("readTime")
        if read_time:
            assert t.instante(read_time) < self.relogio(), f"readTime no futuro: {read_time}"
        self.consultas.append((banco, read_time))
        if banco == self.banco:
            assert read_time in self.origem, f"a origem só se lê no minuto do backup e no seguinte, não em {read_time}"
            caminhos = self.origem[read_time]
        else:
            assert read_time is None and t.NOME_DO_TESTE.match(banco), banco
            caminhos = self.gcloud.bancos[banco]
        nomes = sorted(f"projects/{PROJETO}/databases/{banco}/documents/{caminho}" for caminho in caminhos)
        cursor = consulta.get("startAt")
        if cursor:
            nomes = [nome for nome in nomes if nome > cursor["values"][0]["referenceValue"]]
        nomes = nomes[: consulta["limit"]]
        lido = read_time or "2026-10-25T10:20:00.000001Z"
        return [{"document": {"name": nome}, "readTime": lido} for nome in nomes] or [{"readTime": lido}]


def cenario(
    *,
    no_minuto: set[str],
    no_seguinte: set[str] | None = None,
    no_backup: set[str] | None = None,
    **opcoes: Any,
) -> tuple[GcloudFalso, FirestoreFalso, Relogio]:
    relogio = Relogio()
    gcloud = GcloudFalso(
        backups=[backup("b2")],
        conteudo_do_backup={backup("b2")["name"]: no_minuto if no_backup is None else no_backup},
        **opcoes,
    )
    origem = {MINUTO: no_minuto, SEGUINTE: no_minuto if no_seguinte is None else no_seguinte}
    return gcloud, FirestoreFalso(gcloud, relogio, origem), relogio


def rodar(
    gcloud: GcloudFalso,
    firestore: Any,
    relogio: Relogio,
    *,
    banco: str = "(default)",
    executar: bool = True,
    resumo: Path | None = None,
) -> tuple[int, str]:
    saida = io.StringIO()
    with contextlib.redirect_stdout(saida):
        codigo = t.testar(
            PROJETO,
            banco,
            executar=executar,
            gcloud=gcloud,
            abrir_fetch=lambda: firestore,
            agora=relogio,
            esperar=relogio.esperar,
            resumo=resumo,
        )
    return codigo, saida.getvalue()


DOCUMENTOS = {"customers/BTG_Pactual", "quotes/10045", "quotes/10045/revisoes/1"}


class PlanoTest(unittest.TestCase):
    def test_sem_executar_so_mostra_o_plano(self) -> None:
        gcloud, firestore, relogio = cenario(no_minuto=DOCUMENTOS)
        codigo, saida = rodar(gcloud, firestore, relogio, executar=False)
        self.assertEqual(codigo, 0)
        self.assertEqual(gcloud.chamadas, [["firestore", "backups", "list", f"--project={PROJETO}"]])
        self.assertEqual(firestore.consultas, [])
        self.assertIn("Backup b2 do (default)", saida)
        self.assertIn(f"Banco de teste: {TESTE}.", saida)

    def test_escolhe_o_backup_ready_mais_novo_do_banco(self) -> None:
        backups = [
            backup("velho", snapshot="2026-10-24T04:10:00.5Z"),
            backup("novo", snapshot="2026-10-25T04:12:37Z"),
            backup("criando", snapshot="2026-10-25T09:00:00Z", estado="CREATING"),
            backup("do-rh", banco="dute-rh", snapshot="2026-10-25T06:00:00Z"),
        ]
        gcloud = GcloudFalso(backups=backups)
        self.assertEqual(t.backup_mais_novo(gcloud, PROJETO, "(default)")["name"], backups[1]["name"])
        self.assertEqual(t.backup_mais_novo(gcloud, PROJETO, "dute-rh")["name"], backups[3]["name"])

    def test_sem_backup_ready_do_banco_falha(self) -> None:
        gcloud = GcloudFalso(backups=[backup("do-rh", banco="dute-rh")])
        with self.assertRaisesRegex(t.Falha, r"Nenhum backup READY do \(default\)"):
            t.backup_mais_novo(gcloud, PROJETO, "(default)")

    def test_backup_fora_do_pitr_falha_sem_restaurar(self) -> None:
        gcloud, firestore, relogio = cenario(no_minuto=DOCUMENTOS)
        gcloud.backups = [backup("antigo", snapshot="2026-10-18T09:30:00Z")]
        with self.assertRaisesRegex(t.Falha, "7 dias do PITR"):
            rodar(gcloud, firestore, relogio)
        self.assertEqual([chamada[:3] for chamada in gcloud.chamadas], [["firestore", "backups", "list"]])

    def test_so_a_producao_e_os_dois_bancos(self) -> None:
        gcloud, firestore, relogio = cenario(no_minuto=DOCUMENTOS)
        with self.assertRaisesRegex(t.Falha, "homologação não tem backup"):
            t.testar("dute-homolog", "(default)", executar=True, gcloud=gcloud, abrir_fetch=lambda: firestore, agora=relogio, esperar=relogio.esperar)
        with self.assertRaisesRegex(t.Falha, "fora da lista"):
            rodar(gcloud, firestore, relogio, banco="outro")
        self.assertEqual(gcloud.chamadas, [])


class RestauracaoTest(unittest.TestCase):
    def test_restaura_confere_e_apaga(self) -> None:
        gcloud, firestore, relogio = cenario(no_minuto=DOCUMENTOS)
        with tempfile.TemporaryDirectory() as pasta:
            resumo = Path(pasta) / "resumo.md"
            codigo, saida = rodar(gcloud, firestore, relogio, resumo=resumo)
            texto_do_resumo = resumo.read_text(encoding="utf-8")
        self.assertEqual(codigo, 0, saida)
        restauracoes = [chamada for chamada in gcloud.chamadas if chamada[:3] == ["firestore", "databases", "restore"]]
        self.assertEqual(
            restauracoes,
            [
                [
                    "firestore",
                    "databases",
                    "restore",
                    f"--source-backup={backup('b2')['name']}",
                    f"--destination-database={TESTE}",
                    f"--project={PROJETO}",
                ]
            ],
        )
        self.assertEqual(gcloud.apagados(), [TESTE])
        self.assertEqual(sorted(gcloud.bancos), ["(default)", "dute-rh"])
        self.assertIn("OK: o backup restaurou os 3 documentos do (default).", saida)
        self.assertIn("quotes/*/revisoes", saida)
        self.assertIn("OK: o backup restaurou os 3 documentos do (default).", texto_do_resumo)
        self.assertIn(f"| 25/10/2026 | `(default)` | {SNAPSHOT} | OK:", texto_do_resumo)
        # Os caminhos e os ids nunca saem no log nem no resumo: só as coleções.
        for texto in (saida, texto_do_resumo):
            self.assertNotIn("BTG_Pactual", texto)
            self.assertNotIn("10045", texto)

    def test_le_a_origem_no_minuto_do_backup_e_no_seguinte(self) -> None:
        gcloud, firestore, relogio = cenario(no_minuto=DOCUMENTOS)
        rodar(gcloud, firestore, relogio)
        self.assertEqual(firestore.consultas, [("(default)", MINUTO), ("(default)", SEGUINTE), (TESTE, None)])

    def test_gravacao_dentro_do_minuto_do_backup_explica_a_diferenca(self) -> None:
        # Apagado às 04:12:20 e criado às 04:12:30, antes do retrato das 04:12:37.
        gcloud, firestore, relogio = cenario(
            no_minuto=DOCUMENTOS | {"events/apagado"},
            no_seguinte=DOCUMENTOS | {"events/novo"},
            no_backup=DOCUMENTOS | {"events/novo"},
        )
        codigo, saida = rodar(gcloud, firestore, relogio)
        self.assertEqual(codigo, 0, saida)
        self.assertIn("2 diferença(s) explicada(s) por gravações entre 04:12 e 04:13 UTC", saida)

    def test_documento_faltando_reprova_e_apaga_o_banco_de_teste(self) -> None:
        gcloud, firestore, relogio = cenario(no_minuto=DOCUMENTOS, no_backup={"customers/BTG_Pactual", "quotes/10045"})
        codigo, saida = rodar(gcloud, firestore, relogio)
        self.assertEqual(codigo, 1)
        self.assertIn("::error::FALHA: 1 documento(s) faltando e 0 sobrando", saida)
        self.assertIn("faltando em quotes/*/revisoes: 1", saida)
        self.assertEqual(gcloud.apagados(), [TESTE])

    def test_documento_sobrando_fora_do_minuto_reprova(self) -> None:
        gcloud, firestore, relogio = cenario(no_minuto=DOCUMENTOS, no_backup=DOCUMENTOS | {"events/fantasma"})
        codigo, saida = rodar(gcloud, firestore, relogio)
        self.assertEqual(codigo, 1)
        self.assertIn("sobrando em events: 1", saida)
        self.assertEqual(gcloud.apagados(), [TESTE])

    def test_restauracao_com_erro_reprova_e_apaga_o_banco_de_teste(self) -> None:
        gcloud, firestore, relogio = cenario(no_minuto=DOCUMENTOS, erro_da_restauracao={"code": 13, "message": "internal"})
        codigo, saida = rodar(gcloud, firestore, relogio)
        self.assertEqual(codigo, 1)
        self.assertIn("::error::A restauração falhou: internal", saida)
        self.assertEqual(firestore.consultas, [])
        self.assertEqual(gcloud.apagados(), [TESTE])

    def test_restauracao_que_nao_termina_reprova_e_apaga_o_banco_de_teste(self) -> None:
        gcloud, firestore, relogio = cenario(no_minuto=DOCUMENTOS, nunca_termina=True)
        codigo, saida = rodar(gcloud, firestore, relogio)
        self.assertEqual(codigo, 1)
        self.assertIn("A restauração não terminou em 45 minutos", saida)
        self.assertGreaterEqual(relogio.agora - AGORA, t.PRAZO_DA_RESTAURACAO)
        self.assertEqual(gcloud.apagados(), [TESTE])

    def test_leitura_recusada_reprova_e_apaga_o_banco_de_teste(self) -> None:
        gcloud, _, relogio = cenario(no_minuto=DOCUMENTOS)

        def recusa(url: str, payload: dict[str, Any] | None) -> Any:
            raise RuntimeError("Firestore respondeu HTTP 400: read time too old")

        codigo, saida = rodar(gcloud, recusa, relogio)
        self.assertEqual(codigo, 1)
        self.assertIn("::error::Firestore respondeu HTTP 400", saida)
        self.assertEqual(gcloud.apagados(), [TESTE])

    def test_restauracao_recusada_nao_apaga_nada(self) -> None:
        gcloud, firestore, relogio = cenario(
            no_minuto=DOCUMENTOS,
            falhar={"firestore databases restore": "ERROR: (gcloud.firestore.databases.restore) PERMISSION_DENIED: denied"},
        )
        codigo, saida = rodar(gcloud, firestore, relogio)
        self.assertEqual(codigo, 1)
        self.assertIn("roles/datastore.owner", saida)
        self.assertEqual(gcloud.apagados(), [])
        self.assertEqual(sorted(gcloud.bancos), ["(default)", "dute-rh"])

    def test_espera_o_minuto_seguinte_passar_antes_de_ler(self) -> None:
        # Backup de 30 segundos atrás: a origem às 10:15 só se lê depois das 10:15.
        gcloud, firestore, relogio = cenario(no_minuto=DOCUMENTOS, consultas_ate_terminar=1)
        gcloud.backups = [backup("b3", snapshot="2026-10-25T10:14:30Z")]
        gcloud.conteudo_do_backup = {backup("b3")["name"]: DOCUMENTOS}
        firestore.origem = {"2026-10-25T10:14:00Z": DOCUMENTOS, "2026-10-25T10:15:00Z": DOCUMENTOS}
        codigo, saida = rodar(gcloud, firestore, relogio)
        self.assertEqual(codigo, 0, saida)

    def test_o_dute_rh_restaura_no_banco_de_teste_dele(self) -> None:
        relogio = Relogio()
        gcloud = GcloudFalso(
            backups=[backup("rh1", banco="dute-rh")],
            conteudo_do_backup={backup("rh1", banco="dute-rh")["name"]: {"rh_records/r1", "events/e1"}},
        )
        firestore = FirestoreFalso(gcloud, relogio, {MINUTO: {"rh_records/r1", "events/e1"}, SEGUINTE: {"rh_records/r1", "events/e1"}}, banco="dute-rh")
        codigo, saida = rodar(gcloud, firestore, relogio, banco="dute-rh")
        self.assertEqual(codigo, 0, saida)
        self.assertEqual(gcloud.apagados(), ["teste-restauracao-dute-rh-20261025t101500"])
        self.assertIn("OK: o backup restaurou os 2 documentos do dute-rh.", saida)


class TravaTest(unittest.TestCase):
    def test_apaga_a_sobra_de_teste_anterior_e_nenhum_outro_banco(self) -> None:
        sobra = "teste-restauracao-default-20261024t101500"
        gcloud, firestore, relogio = cenario(
            no_minuto=DOCUMENTOS,
            bancos=["(default)", "dute-rh", sobra, "restauracao-teste", "recuperacao-20261021"],
        )
        codigo, saida = rodar(gcloud, firestore, relogio)
        self.assertEqual(codigo, 0, saida)
        self.assertEqual(gcloud.apagados(), [sobra, TESTE])
        self.assertEqual(sorted(gcloud.bancos), ["(default)", "dute-rh", "recuperacao-20261021", "restauracao-teste"])

    def test_so_o_banco_de_teste_passa_na_trava(self) -> None:
        for nome in (TESTE, "teste-restauracao-dute-rh-20261025t101500"):
            with self.subTest(nome=nome):
                t.exigir_banco_de_teste(nome)
        for nome in (
            "(default)",
            "dute-rh",
            "restauracao-teste",
            "teste-restauracao-default-20261025t1015",
            "teste-restauracao-outro-20261025t101500",
            f"{TESTE}x",
            f"x{TESTE}",
        ):
            with self.subTest(nome=nome), self.assertRaisesRegex(t.Falha, "não é um banco de teste"):
                t.exigir_banco_de_teste(nome)

    def test_apagar_e_restaurar_recusam_antes_de_chamar_o_gcloud(self) -> None:
        gcloud = GcloudFalso(backups=[])
        for nome in ("(default)", "dute-rh"):
            with self.subTest(nome=nome):
                with self.assertRaises(t.Falha):
                    t.apagar(gcloud, PROJETO, nome)
                with self.assertRaises(t.Falha):
                    t.restaurar(gcloud, PROJETO, backup("b2")["name"], nome)
        self.assertEqual(gcloud.chamadas, [])

    def test_o_nome_do_teste_e_o_do_banco_e_do_instante(self) -> None:
        self.assertEqual(t.nome_do_teste("(default)", AGORA), TESTE)
        self.assertEqual(t.nome_do_teste("dute-rh", AGORA), "teste-restauracao-dute-rh-20261025t101500")
        # O Firestore aceita de 4 a 63 caracteres.
        self.assertLessEqual(len(t.nome_do_teste("dute-rh", AGORA)), 63)


class InstanteTest(unittest.TestCase):
    def test_instante_do_firestore(self) -> None:
        self.assertEqual(t.instante(SNAPSHOT), datetime(2026, 10, 25, 4, 12, 37, 123456, tzinfo=timezone.utc))
        self.assertEqual(t.instante("2026-10-25T04:12:37Z"), datetime(2026, 10, 25, 4, 12, 37, tzinfo=timezone.utc))
        self.assertEqual(t.instante("2026-10-25T04:12:37.5Z").microsecond, 500000)
        with self.assertRaises(t.Falha):
            t.instante("2026-10-25 04:12:37")

    def test_permissao_negada_diz_o_papel(self) -> None:
        erro = t.erro_do_gcloud(["firestore", "databases", "restore"], "ERROR: PERMISSION_DENIED: denied")
        self.assertIn("roles/datastore.owner", str(erro))
        self.assertNotIn("roles/datastore.owner", str(t.erro_do_gcloud(["firestore", "databases", "list"], "ERROR: NOT_FOUND")))


if __name__ == "__main__":
    unittest.main()
