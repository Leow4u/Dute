# Validação da ampliação da API — 27/10/2026

Validação local da branch `codex/api-todos-modulos`, baseada na main `3ffd221`.
Este registro não comprova publicação ou validação autenticada em homologação/produção.
O inventário de operações e limites está em [api-cobertura.md](api-cobertura.md).

## Resultados

| Pacote | Unitários completos | Integrações completas |
|---|---:|---:|
| Operação | 225 | 143 |
| Armazenagem (wms) | 283 | 629 |
| Comercial | 552 | 203 |
| Financeiro | 133 | 80 |
| RH | 78 | 43 |
| Agent Dute (core) | 201 | 78 |
| Total | **1.472** | **1.176** |

Todos os casos acima passaram, sem casos pulados. Foram executados os arquivos
registrados nos scripts `test:unit` e `test:integration` de cada pacote, incluindo
os testes existentes de domínio e regras. Cada pacote também passou no `typecheck`.

- Frontend: `npm --prefix artifacts/app test -- --run`, 248 arquivos, **2.844 testes**; `tsc --build`, typecheck do app e build Vite/PWA passaram.
- Ferramentas: `python -m unittest discover -s tools -p 'test_*.py'`, **164 testes**.
- Índices: `python tools/indices_das_consultas.py /tmp/dute-platform-queries.jsonl`, **9.290 consultas, 235 formas, 16 cobertas por índice composto**, sem índice faltante.
- OpenAPI: Swagger Parser validou o documento 3.0 com **62 caminhos / 91 operações**, incluindo gestão de credenciais e as 75 operações novas. Schemas e permissões conferidos pelos testes de contrato.
- Empacotamento: `npm pack --dry-run --json` nos seis pacotes confirmou `lib/api/shared/{core,handler,permissions,manifests}.js`. A fonte compartilhada e a cópia do catálogo do frontend coincidem.
- Revisões independentes de adaptadores/kernel: corrigidos os achados de autorização transacional, versão concorrente do recebimento e travessia de caminho no gateway. Releitura sem achados P0/P1/P2 pendentes.
- Navegador Chromium: desktop 1440×1024 e celular 390×844, criar/copiar/revogar com dados e respostas simulados, política `scoped` conferida no POST, sem exceções JavaScript ou overflow horizontal. Fontes remotas bloqueadas pela rede; fallback inspecionado. Detalhes em `design-qa.md`.

## Execução e ocorrências

Para reproduzir, instale dependências pelos locks de cada pacote e use o Firebase
CLI disponível no PATH. Na raiz, para cada pacote:

```sh
npm --prefix functions/operacao run test:unit
npm --prefix functions/operacao run test:integration
npm --prefix functions/operacao run typecheck
```

Troque `operacao` por `wms`, `comercial`, `financeiro`, `rh` ou `core`. Os scripts
oficiais escolhem o projeto de emulador apropriado. Não execute contra projeto real.

A primeira rodada conjunta usou `demo-dute-api-platform` para todos os pacotes.
A Armazenagem depende de `demo-dute-operations` nas fixtures de Rules/Storage e
falhou 34 de 629 casos nessa invocação. O comando oficial
`npm --prefix functions/wms run test:integration` foi reexecutado com ambos os
emuladores e passou **629/629**, sem alteração no produto para acomodar a invocação.
A Operação foi reexecutada pelo comando oficial após os dois casos adicionais de
criação da política/chave global e gravação scoped: **143/143**.

O Core inicialmente encontrou uma dependência Genkit divergente na instalação
local. `npm ci --prefix functions/core` restaurou a versão do lock e a suíte
completa passou **201/201**, sem alteração de fonte, teste ou lock para contornar
a falha. As suítes dos outros quatro pacotes passaram integralmente na rodada
conjunta com Firestore/Storage locais.

## Antes da liberação

- Abrir PR em rascunho e conferir o CI do commit final.
- Revisar/mesclar e validar os adaptadores e fluxos autenticados em homologação.
- Publicação de produção depende de autorização específica para esta ampliação.
- Não foram emitidas credenciais reais, modificados IAM ou acessos de terceiros,
  nem executados merge/deploy. Testes não acessaram dados pessoais ou bancários reais.
