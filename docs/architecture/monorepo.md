# Arquitetura do monorepo

## Objetivo

O monorepo deve separar o Monitor Legislativo por produto/serviço, não por linguagem.

Estrutura alvo:

```text
monitorlegislativo/
├── 01_admin/
│   ├── docs/
│   ├── migrations/
│   └── scripts/
│
├── 02_pagina_oficial/
│   ├── src/
│   ├── public/
│   └── README.md
│
├── 03_consulta_proposituras/
│   ├── app/
│   ├── core/
│   ├── providers/
│   ├── jobs/
│   ├── data/
│   ├── tests/
│   ├── tools/
│   └── README.md
│
├── docs/
│   ├── architecture/
│   ├── operations/
│   └── migration/
│
├── .github/
│   ├── workflows/
│   ├── copilot-instructions.md
│   └── PULL_REQUEST_TEMPLATE.md
│
├── AGENTS.md
├── CONTRIBUTING.md
└── README.md
```

## Por que 01 / 02 / 03?

A numeração reproduz a ideia da estrutura de referência do projeto de jogos, mas no Monitor os diretórios representam partes do produto:

- `01_admin`: operação interna e manutenção;
- `02_pagina_oficial`: presença institucional/página pública;
- `03_consulta_proposituras`: o serviço principal do Monitor.

Isso deixa espaço para futuros serviços sem misturar responsabilidades.

## Regra de fronteiras

### 01_admin

Não é lugar para o backend principal. Contém documentação operacional, migrações, scripts administrativos e tarefas de manutenção.

### 02_pagina_oficial

Código da página institucional. Deve consumir interfaces do produto quando precisar de dados; não deve acessar diretamente a planilha de produção.

### 03_consulta_proposituras

É o produto principal de consulta e monitoramento legislativo.

- `app/`: entrypoint e camada de apresentação do Apps Script;
- `core/`: regras de negócio e normalização que podem ser testadas isoladamente;
- `providers/`: adaptadores para Câmara, Senado e ALESP;
- `jobs/`: processamento assíncrono/externo ao Web App;
- `data/`: schema, seeds e migrações;
- `tests/`: testes e fixtures;
- `tools/`: scripts de desenvolvimento/manutenção.

## Apps Script

O projeto atual usa Google Apps Script + HTML Service + Google Sheets. O layout local deve manter o código do deploy claramente isolado em `03_consulta_proposituras/app/`.

O `.clasp.json` deve ficar junto ao projeto Apps Script e apontar para o novo projeto Google após a migração. O `scriptId` antigo não deve ser reutilizado.

O Apps Script tem um modelo de projeto diferente de um backend Node tradicional; a organização local existe para manutenção humana e pode exigir adaptação durante o `clasp push`. Não introduzir uma abstração de módulos só por estética.

## Direção arquitetural futura

A direção recomendada é:

```text
Página / UI
    ↓
Camada de aplicação
    ↓
Core de consulta
    ↓
Providers oficiais
    ↓
Câmara | Senado | ALESP

                     ┌→ Google Sheets (estado operacional atual)
Jobs / Workers ──────┤
                     └→ fontes oficiais / processamento pesado
```

O Google Sheets continua como armazenamento operacional enquanto fizer sentido. A arquitetura não deve obrigar uma migração de banco agora.

Quando o volume ou requisitos justificarem, a camada `core` permite trocar o armazenamento ou criar API sem reescrever os providers.

## Princípio

A pasta descreve a responsabilidade do sistema. O nome da tecnologia fica dentro da responsabilidade, e não o contrário.
