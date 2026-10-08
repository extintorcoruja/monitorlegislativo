# Regras para agentes de IA — Monitor Legislativo

Este arquivo é normativo para qualquer agente de IA que leia este repositório.

## Regra 0 — integridade do Git

1. NUNCA fazer commit diretamente em `main`.
2. NUNCA fazer push diretamente em `main`.
3. NUNCA fazer merge de Pull Request.
4. NUNCA fazer squash merge, rebase merge ou criar merge commit destinado à `main`.
5. NUNCA fazer force-push, reset destrutivo ou apagar a `main`.
6. Toda alteração deve nascer em uma branch própria.
7. A IA pode criar e atualizar uma branch de trabalho e pode abrir/atualizar um PR, mas a decisão de merge é humana.
8. Antes de alterar arquivos, confirme o estado e a branch atual.
9. Nunca assumir que uma branch é descartável antes de verificar seu conteúdo.
10. Nunca sobrescrever trabalho existente de outro agente ou colaborador sem comparar o estado atual.

## Branches

Use nomes previsíveis:

- `feat/<escopo>`
- `fix/<escopo>`
- `refactor/<escopo>`
- `chore/<escopo>`
- `docs/<escopo>`
- `migration/<escopo>`
- `hotfix/<escopo>`

Uma tarefa = uma branch. Não misture mudanças sem relação.

## Pull Requests

O PR deve explicar:
- problema ou objetivo;
- escopo;
- arquivos/áreas afetados;
- riscos;
- testes executados;
- migrações/configurações necessárias;
- o que NÃO foi alterado.

A IA não deve aprovar nem fazer merge do próprio PR.

## Mudanças de código

1. Primeiro entender o código atual; depois propor a alteração mínima necessária.
2. Evitar refatorações amplas durante correções funcionais.
3. Não mudar contratos, nomes de colunas, formatos de dados ou integrações sem documentar impacto.
4. Não remover comportamento existente sem identificar seus consumidores.
5. Preservar compatibilidade retroativa quando não houver decisão explícita para quebrá-la.
6. Preferir funções pequenas, responsabilidades claras e nomes que expressem intenção.
7. Lógica de negócio não deve ficar escondida dentro de código de interface.
8. Integrações externas devem ficar isoladas em `providers/` ou adaptadores equivalentes.
9. Acesso à planilha/banco deve ficar isolado da regra de negócio.
10. Não adicionar dependência só para resolver um problema pequeno.

## Apps Script

1. O projeto Google Apps Script é um artefato de execução; o GitHub é a fonte de versionamento.
2. Nunca copiar o `scriptId` antigo para a migração como se fosse o novo.
3. Nunca gravar credenciais OAuth, `.clasprc.json`, tokens, senhas ou secrets no repositório.
4. Configurações de ambiente devem vir de Script Properties, GitHub Secrets ou arquivos locais ignorados.
5. Alterações de deployment devem ser tratadas como operação controlada, nunca como efeito colateral escondido de uma refatoração.
6. Antes de mudar estrutura de dados no Google Sheets, criar/atualizar uma migração explícita.
7. Não apagar dados da planilha em uma mudança de código sem uma ação explícita e documentada.

## Segurança

Nunca colocar no Git:
- `.clasprc.json`;
- `.env`;
- tokens;
- chaves privadas;
- service-account JSON;
- credenciais OAuth;
- senhas reais;
- IDs ou dumps de dados pessoais quando não forem necessários.

Se um segredo aparecer em uma saída de ferramenta, não o reproduzir em outro arquivo, comentário ou PR.

## Dados legislativos

O Monitor depende de fontes oficiais e de dados históricos. Não alterar silenciosamente:
- identificadores oficiais;
- links de fontes;
- situação/regime;
- data de movimentação;
- regras de normalização;
- critérios de deduplicação.

Qualquer mudança semântica precisa de exemplo/fixture ou outra forma de validação.

## Testes e validação

Antes de abrir um PR:
1. executar os testes disponíveis;
2. validar sintaxe;
3. validar arquivos de configuração;
4. revisar o diff inteiro;
5. procurar referências ao código/ID antigo quando a tarefa for de migração;
6. registrar claramente qualquer teste que não pôde ser executado.

Nunca afirmar que algo foi testado quando não foi.

## Migrações

Uma migração deve ser feita em etapas:
1. inventário;
2. cópia/portabilidade;
3. separação de responsabilidades;
4. testes;
5. atualização de configurações;
6. validação operacional;
7. remoção do legado somente depois da confirmação.

Nunca combinar migração + redesign funcional grande no mesmo passo sem necessidade.

## Fonte da verdade

Quando houver conflito entre código, documentação e memória da IA:
1. estado atual do repositório;
2. testes/fixtures;
3. documentação mantida no repositório;
4. decisão explícita do responsável pelo projeto.

Não inventar comportamento ausente.

## Regra final

Quando houver risco de perda de dados, quebra de produção, alteração da `main`, rotação de credenciais, mudança de schema ou mudança irreversível, parar e pedir confirmação humana antes de executar a operação.
