# Instruções para IA — Monitor Legislativo

Leia primeiro:
- `AGENTS.md`
- `CONTRIBUTING.md`
- `docs/architecture/monorepo.md`
- `docs/migration/mapa-v67.md`

Regras críticas:
- Nunca alterar `main` diretamente.
- Nunca fazer merge de PR.
- Sempre trabalhar em branch própria.
- Nunca fazer force-push.
- Não commitar segredos.
- Não alterar schema do Google Sheets sem migração documentada.
- Não trocar IDs/configurações de produção silenciosamente.
- Fazer a menor mudança possível para atingir o objetivo.
- Antes de PR, revisar o diff e declarar os testes executados.
