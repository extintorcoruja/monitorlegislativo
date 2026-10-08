# Monitor Legislativo 2.0 — Fundação

A nova versão nasce sem dependência de Google Apps Script ou Google Sheets.

## Runtime

- Vercel: aplicação web, API e jobs agendados.
- Supabase: PostgreSQL e autenticação quando necessária.
- GitHub: versionamento, revisão e histórico.

## Regra de fronteira

Os provedores de Câmara, Senado e ALESP devem conversar com o domínio por interfaces próprias. Nenhum provider deve depender diretamente de componentes da UI.

O banco guarda dados normalizados e metadados de execução. Payloads grandes de respostas externas não devem ser armazenados indiscriminadamente no PostgreSQL gratuito.

## Próximas camadas

1. contratos comuns dos providers;
2. cliente Câmara;
3. cliente Senado;
4. cliente ALESP;
5. pipeline de ingestão;
6. busca e filtros;
7. autenticação e administração;
8. observabilidade e agendamento.
