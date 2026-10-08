# Contribuindo

## Fluxo obrigatório

`main` representa a linha estável do projeto.

Nenhuma alteração deve ser feita diretamente nela. O fluxo normal é:

`branch de trabalho` → `Pull Request` → revisão humana → merge humano

A IA pode preparar código, testes, documentação e PR. A IA não faz merge.

## Checklist antes do PR

- [ ] Estou em uma branch diferente de `main`.
- [ ] A branch tem um objetivo único.
- [ ] Não há segredos ou credenciais no diff.
- [ ] O código existente foi entendido antes da alteração.
- [ ] Testes/sintaxe foram executados.
- [ ] O diff foi revisado.
- [ ] Migrações de dados, se houver, estão documentadas.
- [ ] Configurações de produção/deployment estão identificadas.
- [ ] O PR informa riscos e passos de validação.

## Convenção de commits

Prefira Conventional Commits:

- `feat:`
- `fix:`
- `refactor:`
- `chore:`
- `docs:`
- `test:`
- `ci:`
- `migration:`

Exemplo:

`migration: reorganiza serviço de consulta de proposituras`

## Regra de merge

O merge é uma ação humana deliberada. O agente de IA nunca deve executar merge, squash, rebase merge ou push para `main`.
