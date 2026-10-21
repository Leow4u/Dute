# Cargas do Comercial

As cargas iniciais do Comercial (`docs/plataforma/fase-6-comercial.md`,
"Importação inicial") rodam em Node dentro de `functions/comercial`. Todas
seguem as mesmas regras:

- **Dry-run por padrão.** Nada é gravado sem `--executar`.
- **Projeto obrigatório para gravar.** `--executar` sem `--projeto` é recusado
  antes de ler qualquer coisa. A carga só grava onde o Comercial está liberado
  (`functions/comercial/src/domain/liberacao.ts`; hoje só o `dute-homolog`) ou
  no emulador (projeto `demo-*`). Na produção, só depois da parte 17.
- **O arquivo fica fora do repositório.** O JSON tem dado de contrato: a carga
  recusa arquivo dentro do repositório, exceto em `tmp/` e `.secrets/`, que o
  git ignora. Nunca commitar o arquivo nem colar o conteúdo dele em serviço
  externo (CLAUDE.md, "Dados sensíveis").
- **Relatório em `tmp/comercial/`**, na raiz do repositório, um JSON por
  execução com o que foi (ou seria) feito em cada item.
- **Mesmas regras das callables.** A carga valida com os schemas das callables
  e grava pelas mesmas operações, com recibo de idempotência e evento. Rodar
  de novo o mesmo arquivo não muda nada.

As credenciais são as do `gcloud auth application-default login` de quem roda.

## Contratos e aditivos (parte 8)

```powershell
cd C:\DEV\Dute
npm --prefix functions/comercial run build
# 1. Confere só o arquivo
node functions/comercial/lib/cargas/contratos.js --arquivo C:\caminho\fora\do\repo\contratos.json
# 2. Compara com o banco, sem gravar
node functions/comercial/lib/cargas/contratos.js --arquivo C:\caminho\fora\do\repo\contratos.json --projeto dute-homolog
# 3. Grava
node functions/comercial/lib/cargas/contratos.js --arquivo C:\caminho\fora\do\repo\contratos.json --projeto dute-homolog --executar
```

Ordem com as tabelas: primeiro os contratos (o aditivo de preço fica de
fora, com o problema "tabela não encontrada"), depois as tabelas com o
`contract_id` do contrato, e por fim a carga de contratos de novo, que só
registra os aditivos que faltavam.

O que a carga faz com cada contrato:

| No banco | Ação |
|---|---|
| Não existe | `criar` com o id do arquivo |
| Existe e igual | `sem_mudanca` |
| Existe e diferente | `atualizar` só os campos que mudaram, na edição atual |

A vigência gravada é a do arquivo prorrogada pelos aditivos: um aditivo de
prorrogação (ou de preço com vigência nova) só muda a vigência quando o fim
novo passa do atual. Aditivo antigo entra só no histórico, em qualquer ordem.

O que deixa um contrato de fora (os outros seguem, e a carga termina com
código 1):

- cadastro inexistente, prospect ou arquivado (contrato é de cliente);
- contrato do arquivo que já existe para outro cliente.

O que deixa só o aditivo de fora (o contrato e os outros aditivos seguem):

- aditivo já registrado com outro conteúdo (aditivo não se altera);
- aditivo de preço com tabela inexistente ou de outro contrato.

### Campos

- `id`: id do documento em `contracts` (letras, números, hífen e sublinhado).
- `contrato`: os campos da callable `saveContract`. Obrigatórios:
  `customer_code` (o código do cadastro), `nome`, `vigente_de`, `vigente_ate`
  (`null` para prazo indeterminado), `renovacao.tipo`, `reajuste.tipo`,
  `regime_padrao`, `autorizacao.tipo`, `pagamento.tipo` e `status`. Preço não
  entra no contrato: as tabelas apontam para ele por `contract_id`.
- `aditivos`: os campos da callable `recordAditivo`. `numero` é a ordem do
  aditivo (vira o id `01`, `02`...); `documento: null` registra o aditivo com a
  marca "documento não localizado".
- Datas em `AAAA-MM-DD`; a data-base do reajuste em `MM-DD`.
- `documentos[].referencia` é texto (por exemplo, o caminho no OneDrive): o
  Storage é fechado ao Comercial no v1.

### Exemplo sintético

Números e nomes inventados, só para mostrar o formato. O teste
`functions/comercial/src/cargas/contratos.test.ts` valida este exemplo.

<!-- exemplo-contratos -->
```json
{
  "contratos": [
    {
      "id": "exemplo-2026",
      "contrato": {
        "customer_code": "EXEMPLO",
        "nome": "Contrato de serviços de mudança",
        "numeros": [
          { "tipo": "contrato", "numero": "0000000000-0" },
          { "tipo": "sistema_cliente", "numero": "SC-0001" }
        ],
        "objeto": "Mudanças, montagem e desmontagem de mobiliário.",
        "vigente_de": "2026-07-01",
        "vigente_ate": "2027-06-30",
        "renovacao": { "tipo": "aditivo", "aviso_dias": 30, "oposicao_ate_dias": null },
        "reajuste": { "tipo": "indice", "indice": "IPCA", "data_base": "07-01" },
        "regimes": [
          { "servico": "Mudança", "regime": "por_demanda" },
          { "servico": "Equipe fixa", "regime": "medicao_mensal" }
        ],
        "regime_padrao": "por_demanda",
        "autorizacao": { "tipo": "pedido_aceite", "prazo_perda_dias": null },
        "pagamento": {
          "tipo": "faixas_do_dia_da_nf",
          "faixas": [
            { "de": 1, "ate": 10, "dia": 30, "mes": "mesmo" },
            { "de": 11, "ate": 20, "dia": 10, "mes": "seguinte" },
            { "de": 21, "ate": 31, "dia": 30, "mes": "seguinte" }
          ],
          "dias": null,
          "texto": null
        },
        "impostos": { "inclusos": true, "texto": "Tributos inclusos no preço." },
        "codigo_servico": "1602",
        "documentos": [
          { "nome": "Contrato assinado", "referencia": "OneDrive/Comercial/Contratos/exemplo/contrato.pdf" }
        ],
        "status": "vigente"
      },
      "aditivos": [
        {
          "numero": 1,
          "assinado_em": null,
          "tipo": "prorrogacao",
          "vigente_de": "2025-07-01",
          "vigente_ate": "2026-06-30",
          "tabela_ids": [],
          "documento": null,
          "observacao": "Documento não localizado."
        },
        {
          "numero": 2,
          "assinado_em": "2026-06-20",
          "tipo": "preco",
          "vigente_de": "2026-07-01",
          "vigente_ate": "2027-06-30",
          "tabela_ids": ["exemplo-2026-comercial", "exemplo-2026-noturna"],
          "documento": { "nome": "Aditivo 2", "referencia": "OneDrive/Comercial/Contratos/exemplo/aditivo-2.pdf" },
          "observacao": ""
        }
      ]
    }
  ]
}
```
