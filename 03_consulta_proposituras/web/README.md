# Web — Monitor Legislativo 2.0

Aplicação Next.js do Monitor Legislativo.

## Princípios

- O frontend não acessa diretamente credenciais de servidor.
- O banco é PostgreSQL no Supabase.
- Integrações com Câmara, Senado e ALESP ficam fora da camada web.
- Mudanças devem passar por branch própria e pull request.
- A branch `main` nunca é alterada diretamente.

## Desenvolvimento

```bash
npm install
npm run typecheck
npm run build
```

Configure as variáveis listadas em `.env.example`.
