# Serviço de consulta de proposituras

## Responsabilidade

Este serviço acompanha proposituras legislativas, realiza consultas em fontes oficiais, detecta mudanças e registra histórico/avaliação.

Fontes atuais identificadas no código legado:
- Câmara dos Deputados;
- Senado Federal;
- ALESP.

## Componentes

### App

Responsável por:
- autenticação da interface;
- dashboard;
- leitura/gravação de dados;
- fluxo de verificação;
- apresentação de alterações, candidatas e relatórios.

### Core

Responsável por regras como:
- normalização;
- chave/identidade de proposituras;
- comparação de estado;
- deduplicação;
- validação de candidatas;
- regras de negócio independentes da fonte.

### Providers

Cada fonte deve possuir um adaptador isolado. O provider traduz o formato externo para um modelo interno do Monitor.

Não espalhar URLs/XML/JSON específicos da fonte por toda a aplicação.

### Jobs

Processamentos demorados ou externos ao ciclo de uma requisição do Web App.

Exemplo já existente no legado:
- processamento sob demanda dos regimes ALESP via GitHub Actions + Python.

### Data

Definições e migrações da estrutura de dados do Google Sheets:
- `PROPOSITURAS`
- `PALAVRAS_CHAVE`
- `VERIFICACOES`
- `ALTERACOES`
- `CANDIDATAS`
- `RELATORIOS`
- `BUSCAS_MANUAIS`

Essas abas são parte do contrato operacional e qualquer mudança deve ter migração.

## Modelo interno

Toda fonte deve convergir para um modelo interno equivalente a:

```text
Propositura
 ├── fonte/origem
 ├── id oficial
 ├── tipo/número/ano
 ├── autor
 ├── ementa
 ├── situação
 ├── regime (quando aplicável)
 ├── última tramitação
 ├── datas
 └── link oficial
```

O modelo é conceitual; não criar campos novos apenas por antecipação.

## Não objetivos

Esta reorganização não pretende:
- trocar Apps Script por outro runtime imediatamente;
- trocar Google Sheets por banco imediatamente;
- reescrever toda a UI;
- alterar o comportamento funcional do Monitor sem necessidade.

Primeiro separar responsabilidades; depois modernizar pontos que realmente tragam benefício.
