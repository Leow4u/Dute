# Validação local — chaves pessoais — 27/10/2026

Branch `codex/chaves-api-por-usuario`, base da main `440f1a0` (PR #517). Esta validação não significa merge ou publicação do novo modelo.

## Suítes completas

| Pacote | Unitários | Integrações oficiais |
|---|---:|---:|
| Operação | 260 | 155 |
| Armazenagem | 288 | 632 |
| Comercial | 554 | 205 |
| Financeiro | 137 | 82 |
| RH | 81 | 45 |
| Core | 203 | 82 |
| Total | **1.523** | **1.201** |

Comandos: `npm --prefix functions/<pacote> run test:unit`, `run test:integration` e `run typecheck` para cada um dos seis pacotes. Os scripts oficiais de integração iniciam Firestore/Storage locais com o projeto correto de cada pacote. Todas as suítes e os seis typechecks passaram; nenhum teste pulado. A rodada final das integrações rodou sequencialmente para não disputar a porta do emulador.

- Frontend: 248 arquivos, **2.855 testes** em `npm --prefix artifacts/app test`; `tsc --build`, typecheck do app e build Vite/PWA passaram. Os seis testes da página/diálogo/a11y foram reexecutados após o ajuste visual final.
- Python: `python -m unittest discover -s tools -p 'test_*.py'`, **164 testes** passaram.
- Índices: `python tools/indices_das_consultas.py /tmp/personal-final-queries.jsonl`, **5.915 consultas, 240 formas, 16 com índice composto**, sem falta de índice.
- Swagger Parser validou OpenAPI 3.0.3: **65 caminhos, 95 operações**. Os quatro métodos novos são de gestão pessoal; não foram acrescentadas novas ações de negócio aos módulos.
- `npm pack --dry-run --json` confirmou `lib/api/shared/{core,handler,principal,permissions,manifests}.js` nos seis pacotes, sem depender da fonte do monorepo no runtime.

## Casos observados em RED → GREEN

- Gestão por qualquer um dos11papéis, lista/revogação por titular, segredo só na criação, full/read_only/custom, capacidades atuais, vínculo/contrato e configuração inválida: sete casos inicialmente falharam com401 porque a gestão pessoal não existia; depois passaram.
- Omissão de cliente em conta da equipe e filtro/escala do campo: três falhas iniciais, corrigidas usando abrangência atual e UID humano. Escala malformada em string não autoriza pelo texto.
- Política por módulo/escopo e vínculo ausente: dois unitários falharam antes das guardas e depois passaram. Contrato da gestão pessoal ausente também foi capturado antes do OpenAPI novo.
- WMS: mesmo recibo após conta mudar A→B devolvia200 indevidamente; a validação de `body.customer_code` agora precede o recibo e retorna403.
- Core: rotina continuava acessível após contrato virar `[]`; lista/detalhe passaram a conferir o contrato. POST/PATCH concluídos ainda devolviam recibo após essa retirada; hook de autorização anterior ao recibo corrigiu o caso. Replay autorizado com a versão antiga continua funcionando, sem refazer CAS/estado da operação.
- Financeiro: projeção do portal ganhou whitelist própria e limpeza do objeto NF aninhado; não retorna vínculos e campos internos da fatura.
- Atores pessoais de Comercial/Financeiro/RH/Core/WMS mantêm papel real, sem satisfazer guardas por troca para papel privilegiado. Legado mantém política e cliente originais, cobertos pelas suítes existentes e por cenário de coexistência.

## Navegador

Chromium local/Playwright, desktop1440×1024 e celular390×844, sessão e respostas de API simuladas. Criar full como owner, criar read_only como conta comum, opções custom, copiar uma única revelação, concluir/descarte, cancelar e confirmar revogação. Nenhuma chamada à lista de clientes, exceção JavaScript ou overflow horizontal. Evidências locais em `/workspace/dute-personal-keys-preview/`.

O runtime do plugin Browser não estava disponível nas ferramentas da sessão; foi usado Playwright já instalado, conforme validação local com mocks autorizada. A rede bloqueou fontes remotas (`ERR_TUNNEL_CONNECTION_FAILED`); fallback legível foi inspecionado. Ajustados locators/reentrada do harness após duas falhas do script de prévia; não foram alteradas regras de produto para acomodá-las. Corrigida também a herança dos tokens v3 no diálogo portalizado, cuja ação aparecia azul em vez do vermelho do Dute. A lista legada mostra Sem registro quando não há histórico de uso, sem afirmar que nunca foi utilizada.

## Entrega e limites

Revisão independente final e CI do PR devem ser registrados no momento da entrega. Regras de acesso e limites das rotas estão em [api-chaves-pessoais.md](api-chaves-pessoais.md) e [api-personal-adapters.md](api-personal-adapters.md).

Não foram geradas chaves reais, executadas operações com dados reais, alterados IAM ou configurados acessos de terceiros. Não houve novo merge/deploy. Validação autenticada em homologação continua sendo uma etapa posterior à revisão e autorização de liberação.
