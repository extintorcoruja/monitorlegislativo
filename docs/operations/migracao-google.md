# Migração de ambiente Google

## Objetivo

Transferir a execução do Monitor para o novo ambiente Google sem levar acidentalmente configurações do ambiente antigo.

## Sequência recomendada

1. Criar/confirmar o novo projeto Google Apps Script.
2. Criar/confirmar a nova planilha de produção.
3. Configurar Script Properties:
   - `APP_PASSWORD`
   - `SHEET_ID`
   - `INTEGRATION_SECRET`
   - `GITHUB_TOKEN`
   - outras propriedades usadas pelo código.
4. Gerar nova configuração `.clasp.json` com o novo `scriptId`.
5. Configurar GitHub Secret `CLASPRC_JSON` para a nova conta Google.
6. Atualizar deployment ID/URL do novo Web App.
7. Atualizar callbacks e referências do repositório.
8. Executar preparação/migração de banco.
9. Validar consultas de Câmara, Senado e ALESP.
10. Validar atualização de regimes ALESP.
11. Só depois aposentar o ambiente antigo.

## Regra

Não reutilizar credenciais ou IDs do ambiente antigo só porque ainda funcionam.

A migração de identidade é separada da refatoração de código.
