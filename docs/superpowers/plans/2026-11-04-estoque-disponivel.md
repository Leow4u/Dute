# Plano: aviso de estoque disponível

**Objetivo:** um aviso por recebimento guardado, com e-mail opcional por contato.
**Desenho:** `docs/superpowers/specs/2026-11-04-estoque-disponivel-design.md`.

- [x] Cadastro e portal: teste falhando para novo modelo, adicionar lista/rótulo e
  contrato da API, validar adesão/desligamento, renderização e acessibilidade.
- [x] WMS: teste falhando para evento final por linha, implementar comprovação de
  guarda integral e deduplicação transacional; cobrir entrada direta, parcial e concorrência.
- [x] Operação: teste falhando para consumir evento, validar fonte/cliente/estado e
  compor resumo público; integrar sino/fila e provar opt-in, isolamento e repetição.
- [x] Atualizar manual, rodar suites das codebases alteradas, typecheck e build.
- [x] Revisar diff de forma independente, corrigir achados, preparar PR com validação.

Sem alteração de regras de permissão, envio real ou deploy neste trabalho.

Validação local: 3.106 testes do app, typecheck e build; Comercial 557 unitários
e 216 de integração; Operação 274 unitários e 193 de integração; WMS 450 unitários
e 127 de integração dirigidos, incluindo faturamento pelas callables. Revisão
independente concluída sem bloqueios. Entrega real de e-mail será conferida na
homologação conforme o desenho.
