# Academia — Treino Offline (PWA)

Aplicativo de controle de treinos que funciona offline. Site 100% estático: **não há build, `npm install` nem dependências** — é apenas HTML, CSS e JavaScript.

## Requisitos

- Navegador moderno (Chrome/Edge recomendados para salvar no próprio arquivo)
- Opcional: Python 3 ou Node.js para rodar um servidor local

## Formas de executar

### 1. Abrir direto no navegador (mais simples)

1. Abra a pasta do projeto
2. Dê dois cliques em `index.html`

> Pelo protocolo `file://` o Service Worker não é registrado, ou seja, o modo offline (PWA) não é testado. Para isso, use um servidor local.

### 2. Servidor local (recomendado)

Qualquer servidor estático funciona:

**Python:**

```bash
python -m http.server 8000
# abra http://localhost:8000
```

**Node.js (sem instalar nada):**

```bash
npx serve .
# abra a URL mostrada no terminal
```

**VS Code:** extensão Live Server → botão *Go Live*.

### 3. Deploy automático (GitHub Pages)

A cada push em `main`, o workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
configura o Node, valida a estrutura, verifica a sintaxe de todos os `js/`,
roda os testes (`npm test`), valida a biblioteca e publica no GitHub Pages.

1. No repositório: **Settings → Pages → Source: GitHub Actions**
2. `git push` para `main`
3. Site publicado em `https://gustavoaca.github.io/academia/`

## Estrutura

```
index.html          App principal (sem scripts inline: só #app, #toast e os módulos)
exemplo.html        Cópia de exemplo para referência
css/styles.css      Estilos (arquivo único, organizado em secções numeradas)
js/app.js           Orquestrador fino: boot, initApp e composição das telas
js/core/            Núcleo compartilhado: utils, estado, render, rotas, toast,
                    programa, seed, importação, log do dia, gráficos e cálculos
js/telas/           Uma tela por arquivo (treino, rotina, relatorio, medidas,
                    alimentacao, foco) + index.js com o barrel de exports
js/eventos/         Despacho de eventos: globais, navegação e index.js (dispatch)
js/pwa.js           Toast global e registro do service worker
js/*.js             Camada de dados e serviços (db, biblioteca, validador, ...)
scripts/            Ferramentas de linha de comando (dump e validação da biblioteca)
prompts/            Prompt reutilizável para gerar exercícios/treinos com IA
tests/              Testes unitários (node:test, sem dependências)
manifest.json       Configuração do PWA
service-worker.js   Cache offline (versão bumpada a cada mudança de asset)
icons/              Ícones do app
.github/workflows/  Sintaxe, testes, validação e deploy no GitHub Pages
```

Cada tela se registra em `js/core/rotas.js` (`registrarTela`) e expõe os handlers
`aoClicar` / `aoDigitar` / `aoMudar`, que `js/eventos/index.js` despacha de acordo
com a ação/elemento (contrato: retornar `true` quando o evento foi tratado).

## Testes

```bash
npm test           # suíte com o runner nativo do Node (node:test)
npm run validar    # valida a biblioteca de exercícios e o gerador de rotinas
```

- Não há `npm install`: os testes usam apenas o Node (>= 20.19) e o runner nativo.
- A CI roda `node --check` em todos os `js/`, os testes e a validação da
  biblioteca antes de publicar no GitHub Pages.

## Gerar novos exercícios com IA

```bash
node scripts/dump-biblioteca.mjs     # estado atual (cole como contexto no prompt)
# edite seguindo prompts/treinos.md
node scripts/validar-biblioteca.mjs  # valida formato, vocabulário e o gerador
```

Sugestão de rotina pronta (`treino-sugerido.json`): aba **Foco** →
"Já tenho um treino (JSON)" → colar → prévia editável → aplicar.

## Dados e backup

- Os dados ficam salvos no próprio aparelho (`localStorage` / IndexedDB)
- Use o botão de salvar arquivo para exportar/importar o progresso em um arquivo HTML
