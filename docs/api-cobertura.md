# Cobertura da API externa nesta versão

Este inventário descreve o código proposto, não confirma publicação. A API de Operação existente é mantida; as tabelas abaixo registram as 75 novas rotas implementadas. Consulte OpenAPI para schemas completos.

## Cobertura e limites

| Módulo | Implementado | Explicitamente fora desta versão |
|---|---|---|
| Operação | Demandas, OS, agenda, recursos; demanda direta, abertura, planejamento e agendamento já existentes | Novos endpoints de execução/revisão e escrita de equipe/veículos |
| Armazenagem | Catálogo/posições/estoque/pedidos/recebimentos/movimentos; criar, aprovar e encerrar pedido; criar/conferir/concluir recebimento; movimentar pelo ledger | Escrita de catálogo/posições; anexos/custos; cancelar/rejeitar/estornar; picking/packing/shipping/putaway e devoluções |
| Comercial | Cadastro de clientes/locais/contatos, contratos/aditivos, orçamento rascunho, medição/linhas, consultas/revisões/tabelas | Aprovações/transições de orçamento e medição; excluir/arquivar; alterar tabelas imutáveis; documentos/anexos |
| Financeiro | A faturar por demanda/armazenagem/medição, faturas/pagamentos; registrar NF externa, documentar envio e recebido | Emitir NF ou baixa Omie; operação bancária; cancelar/estornar; acima de 250 vínculos/pagamentos por fatura é recusado |
| RH | Colaboradores, pessoais separados, registros/vínculos, arquivo com abertura auditada; criar/alterar registros e vínculos | Upload/anexo/exportações, resultados clínicos e CRUD do cadastro operacional de colaboradores |
| Agent Dute | Playbooks/rotinas da própria integração; criar/alterar com versão e autoria; rotinas obrigatoriamente pausadas e de Armazenagem/Operação com leitura concedida | Conversas/notas/contexto de IA, modelos/geração, execução/agendamento ativo e rotinas de Comercial/Financeiro/RH |

## Bloqueios de liberação

- Revisão, CI e publicação ainda necessários. Nenhum módulo novo foi colocado em produção nesta tarefa.
- Não há acesso real/IAM/credencial adicional configurado por este trabalho.
- A abertura real de documento do RH continua dependendo das permissões de assinatura do runtime já usadas pelo módulo; os testes desta API não abrem arquivo de pessoa real.
- O kernel fecha recibos incertos para nova execução; recuperação de um efeito ambíguo exige verificar dados e suporte. Não há desbloqueio automático.

## Rotas novas

### Armazenagem — 15 rotas

| Método | Caminho | Escopo |
|---|---|---|
| GET | `/api/v1/armazenagem/catalogo` | `armazenagem:ler` |
| GET | `/api/v1/armazenagem/posicoes` | `armazenagem:ler` |
| GET | `/api/v1/armazenagem/estoque` | `armazenagem:ler` |
| GET | `/api/v1/armazenagem/pedidos` | `armazenagem:ler` |
| GET | `/api/v1/armazenagem/recebimentos` | `armazenagem:ler` |
| GET | `/api/v1/armazenagem/movimentacoes` | `armazenagem:ler` |
| GET | `/api/v1/armazenagem/pedidos/{id}` | `armazenagem:ler` |
| GET | `/api/v1/armazenagem/recebimentos/{id}` | `armazenagem:ler` |
| GET | `/api/v1/armazenagem/recebimentos/{id}/itens` | `armazenagem:ler` |
| POST | `/api/v1/armazenagem/pedidos` | `armazenagem:pedidos:gravar` |
| PATCH | `/api/v1/armazenagem/pedidos/{id}` | `armazenagem:pedidos:gravar` |
| POST | `/api/v1/armazenagem/recebimentos` | `armazenagem:recebimentos:gravar` |
| PATCH | `/api/v1/armazenagem/recebimentos/{id}` | `armazenagem:recebimentos:gravar` |
| POST | `/api/v1/armazenagem/recebimentos/{id}/avancar` | `armazenagem:recebimentos:gravar` |
| POST | `/api/v1/armazenagem/movimentacoes` | `armazenagem:estoque:movimentar` |

### Comercial — 32 rotas

| Método | Caminho | Escopo |
|---|---|---|
| GET | `/api/v1/comercial/clientes` | `comercial:ler` |
| GET | `/api/v1/comercial/clientes/{id}` | `comercial:ler` |
| GET | `/api/v1/comercial/locais` | `comercial:ler` |
| GET | `/api/v1/comercial/locais/{id}` | `comercial:ler` |
| GET | `/api/v1/comercial/contatos` | `comercial:ler` |
| GET | `/api/v1/comercial/contatos/{id}` | `comercial:ler` |
| GET | `/api/v1/comercial/contratos` | `comercial:ler` |
| GET | `/api/v1/comercial/contratos/{id}` | `comercial:ler` |
| GET | `/api/v1/comercial/tabelas` | `comercial:ler` |
| GET | `/api/v1/comercial/tabelas/{id}` | `comercial:ler` |
| GET | `/api/v1/comercial/demandas` | `comercial:ler` |
| GET | `/api/v1/comercial/demandas/{id}` | `comercial:ler` |
| GET | `/api/v1/comercial/orcamentos` | `comercial:ler` |
| GET | `/api/v1/comercial/orcamentos/{id}` | `comercial:ler` |
| GET | `/api/v1/comercial/medicoes` | `comercial:ler` |
| GET | `/api/v1/comercial/medicoes/{id}` | `comercial:ler` |
| GET | `/api/v1/comercial/contratos/{id}/aditivos` | `comercial:ler` |
| GET | `/api/v1/comercial/orcamentos/{id}/revisoes` | `comercial:ler` |
| POST | `/api/v1/comercial/clientes` | `comercial:clientes:gravar` |
| PATCH | `/api/v1/comercial/clientes/{id}` | `comercial:clientes:gravar` |
| POST | `/api/v1/comercial/locais` | `comercial:clientes:gravar` |
| PATCH | `/api/v1/comercial/locais/{id}` | `comercial:clientes:gravar` |
| POST | `/api/v1/comercial/contatos` | `comercial:clientes:gravar` |
| PATCH | `/api/v1/comercial/contatos/{id}` | `comercial:clientes:gravar` |
| POST | `/api/v1/comercial/contratos` | `comercial:contratos:gravar` |
| PATCH | `/api/v1/comercial/contratos/{id}` | `comercial:contratos:gravar` |
| POST | `/api/v1/comercial/contratos/{id}/aditivos` | `comercial:contratos:gravar` |
| POST | `/api/v1/comercial/orcamentos` | `comercial:orcamentos:gravar` |
| PATCH | `/api/v1/comercial/orcamentos/{id}` | `comercial:orcamentos:gravar` |
| POST | `/api/v1/comercial/medicoes` | `comercial:medicoes:gravar` |
| PATCH | `/api/v1/comercial/medicoes/{id}/linhas` | `comercial:medicoes:gravar` |
| POST | `/api/v1/comercial/clientes/{id}/marcar-cliente` | `comercial:clientes:gravar` |

### Financeiro — 8 rotas

| Método | Caminho | Escopo |
|---|---|---|
| GET | `/api/v1/financeiro/a-faturar` | `financeiro:ler` |
| GET | `/api/v1/financeiro/a-faturar/armazenagem` | `financeiro:ler` |
| GET | `/api/v1/financeiro/a-faturar/medicoes` | `financeiro:ler` |
| GET | `/api/v1/financeiro/faturas` | `financeiro:ler` |
| GET | `/api/v1/financeiro/pagamentos` | `financeiro:ler` |
| POST | `/api/v1/financeiro/faturas` | `financeiro:faturas:gravar` |
| PATCH | `/api/v1/financeiro/faturas/{id}/cobranca` | `financeiro:cobrancas:gravar` |
| POST | `/api/v1/financeiro/faturas/{id}/pagamentos` | `financeiro:pagamentos:registrar` |

### RH — 12 rotas

| Método | Caminho | Escopo |
|---|---|---|
| GET | `/api/v1/rh/colaboradores` | `rh:ler` |
| GET | `/api/v1/rh/colaboradores/{id}` | `rh:ler` |
| GET | `/api/v1/rh/registros` | `rh:ler` |
| GET | `/api/v1/rh/registros/{id}` | `rh:ler` |
| GET | `/api/v1/rh/vinculos` | `rh:ler` |
| GET | `/api/v1/rh/vinculos/{id}` | `rh:ler` |
| GET | `/api/v1/rh/colaboradores/{id}/pessoais` | `rh:pessoais:ler` |
| GET | `/api/v1/rh/registros/{id}/arquivo` | `rh:documentos:ler` |
| POST | `/api/v1/rh/registros` | `rh:registros:gravar` |
| PATCH | `/api/v1/rh/registros/{id}` | `rh:registros:gravar` |
| POST | `/api/v1/rh/vinculos` | `rh:vinculos:gravar` |
| PATCH | `/api/v1/rh/vinculos/{id}` | `rh:vinculos:gravar` |

### Agent Dute — 8 rotas

| Método | Caminho | Escopo |
|---|---|---|
| GET | `/api/v1/agente/playbooks` | `agente:ler` |
| GET | `/api/v1/agente/playbooks/{id}` | `agente:ler` |
| POST | `/api/v1/agente/playbooks` | `agente:playbooks:gravar` |
| PATCH | `/api/v1/agente/playbooks/{id}` | `agente:playbooks:gravar` |
| GET | `/api/v1/agente/rotinas` | `agente:ler` |
| GET | `/api/v1/agente/rotinas/{id}` | `agente:ler` |
| POST | `/api/v1/agente/rotinas` | `agente:rotinas:gravar` |
| PATCH | `/api/v1/agente/rotinas/{id}` | `agente:rotinas:gravar` |
