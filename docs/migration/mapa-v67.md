# Mapa de migração — legado V6.7

Fonte analisada: `kauepierrii-art/monitor-legislativo`.

O repositório legado contém o Apps Script V6.7, interface HTML, automações GitHub Actions, scripts Python e dados/seeds históricos.

## Mapeamento

| Legado | Destino recomendado | Ação |
|---|---|---|
| `Code.gs` | `03_consulta_proposituras/app/`, `core/`, `providers/` | dividir por responsabilidade |
| `BaseInicial.gs` | `03_consulta_proposituras/data/seed/BaseInicial.gs` | preservar como seed/migração |
| `Index.html` | `03_consulta_proposituras/app/frontend/Index.html` | mover |
| `Styles.html` | `03_consulta_proposituras/app/frontend/Styles.html` | mover |
| `appsscript.json` | `03_consulta_proposituras/app/appsscript.json` | mover |
| `.clasp.json` | `03_consulta_proposituras/app/.clasp.json` | recriar para o novo projeto Google |
| `.gitignore` | raiz | consolidar |
| `.github/workflows/deploy-appscript.yml` | `.github/workflows/03-consulta-deploy-appscript.yml` | reorganizar e corrigir IDs |
| `.github/workflows/alesp-regimes-on-demand.yml` | `.github/workflows/03-consulta-alesp-regimes.yml` | reorganizar |
| `.github/workflows/apply-alesp-*.yml` | `.github/workflows/03-consulta-*.yml` | reorganizar/revisar |
| `.github/scripts/process_alesp_regimes.py` | `03_consulta_proposituras/jobs/alesp/process_regimes.py` | mover |
| `.github/scripts/apply_alesp_*.py` | `03_consulta_proposituras/jobs/alesp/` | mover/revisar |
| `tools/apply_loading_ui.py` | `03_consulta_proposituras/tools/` | mover |
| `README.md` | raiz + README do serviço | dividir |
| `LEIA-ME.txt` | `docs/migration/` ou histórico | consolidar e depois aposentar |

## Funções identificadas no Code.gs

A análise do arquivo encontrou responsabilidades misturadas no mesmo arquivo, incluindo:

- autenticação e sessão;
- preparação/migração do banco;
- dashboard;
- CRUD/leitura de proposituras;
- alterações;
- candidatas;
- verificação;
- Câmara;
- Senado;
- ALESP;
- pesquisa guiada/manual;
- relatórios;
- palavras-chave;
- Sheets;
- HTTP/XML/normalização;
- integração GitHub/ALESP.

Isso confirma que a divisão por responsabilidade é apropriada.

## Divisão inicial do Code.gs

### `app/server/`

- `auth.gs`
  - `login`
  - `validarSessao_`
  - `alterarSenhaAcesso`
  - `getConfiguracoes`

- `dashboard.gs`
  - `getDashboard`

- `proposituras.gs`
  - `getProposituras`
  - identidade/atualização de proposituras

- `alteracoes.gs`
  - `getAlteracoes`
  - `setAlteracaoStatus`
  - `reverterAlteracao`

- `candidatas.gs`
  - `getCandidatasPendentes`
  - `registrarCandidataManual`
  - `atualizarCandidata`
  - validação/aprovação/ignorância

- `verificacoes.gs`
  - `iniciarVerificacao`
  - `getVerificacaoAtual`
  - `concluirVerificacaoTecnica`
  - `reverificarFonte`

- `pesquisas.gs`
  - pesquisa diária;
  - busca guiada;
  - buscas manuais.

- `relatorios.gs`
  - preparação/salvamento/leitura de relatórios.

### `providers/`

- `camara.gs`
  - consulta e parsing da Câmara.

- `senado.gs`
  - consulta e parsing do Senado.

- `alesp.gs`
  - consultas XML;
  - tratamento de regime;
  - retry e normalização específica.

### `data/`

- `sheets.gs`
  - `getDb_`
  - `ensureSheet_`
  - `getRows_`
  - `appendObject_`
  - `updateById_`

- `migrations/`
  - `prepararBancoV67`
  - migrações legadas.

- `seed/`
  - `BaseInicial.gs`

### `core/`

Mover gradualmente:
- `normalizar_`
- `semAcento_`
- `chaveProp_`
- `labelProp_`
- `matchWords_`
- `uniqueWords_`
- validações/deduplicação
- comparação de estados e alterações

A regra é não mover por mover. Primeiro testar a responsabilidade; depois separar.

## Automação ALESP

A implementação legada já possui GitHub Actions + Python para processamento de regimes ALESP. Ela deve continuar existindo, mas os scripts específicos do produto não devem ficar espalhados em `.github/scripts/` para sempre.

Destino:

```text
03_consulta_proposituras/
└── jobs/
    └── alesp/
        ├── process_regimes.py
        ├── apply_github_bridge.py
        └── ...
```

Os workflows continuam na raiz de `.github/workflows/` porque são infraestrutura do repositório.

## Pendências obrigatórias da migração

O legado possui referências específicas do ambiente antigo que precisam ser substituídas antes do novo deploy:

1. `scriptId` do antigo projeto Apps Script no `.clasp.json`;
2. deployment ID usado pelo workflow de deploy;
3. URL de callback do Web App nos jobs ALESP;
4. owner/repositório citado pelo Apps Script ao disparar workflow;
5. secrets do GitHub: `CLASPRC_JSON`, `INTEGRATION_SECRET` e quaisquer outros necessários;
6. Script Properties do novo projeto Google Apps Script;
7. ID da planilha do novo ambiente, quando aplicável;
8. validação do acesso anônimo do Web App;
9. validação da integração GitHub → Actions → callback Apps Script.

Nada disso deve ser alterado silenciosamente durante uma refatoração.
