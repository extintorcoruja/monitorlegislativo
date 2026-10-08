# Monitor Legislativo

Monorepo do Monitor Legislativo, migrado do repositório legado `kauepierrii-art/monitor-legislativo`.

## Estado da migração

A branch `migration/v6.7-monorepo` contém a V6.7 funcional na nova organização, com o Apps Script isolado em `03_consulta_proposituras/app/` e o processamento ALESP em `03_consulta_proposituras/jobs/alesp/`.

A migração é deliberadamente conservadora: primeiro preservamos o comportamento; depois fazemos a refatoração interna do `Code.gs` em `app/server`, `core`, `providers` e `data`.

## Estrutura

```text
01_admin/                  operação e migrações
02_pagina_oficial/         presença institucional
03_consulta_proposituras/  serviço principal
  app/                     Google Apps Script + UI
  core/                    regras de negócio
  providers/               Câmara, Senado e ALESP
  jobs/                    processamento assíncrono
  data/                    dados e migrações
  tests/                   testes
  tools/                   ferramentas

docs/                      arquitetura, operação e migração
.github/                   CI/CD e políticas
```

## Regra de Git

`main` é protegida. Agentes de IA nunca fazem commit, push ou merge em `main`. Toda alteração deve ocorrer em branch própria e terminar em Pull Request para revisão humana.

Leia `AGENTS.md` antes de trabalhar no repositório.

## Configuração Google

O novo ambiente precisa de um novo Apps Script, nova configuração `.clasp.json` local, novos secrets e novo deployment. O `scriptId` e o deployment do projeto antigo não são reutilizados.
