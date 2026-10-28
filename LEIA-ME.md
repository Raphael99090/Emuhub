# Emu Hub

O hub vira um app Android: o mesmo código da PWA dentro de um WebView, com tela cheia imersiva e vibração.

## Jeito fácil (sem instalar nada): GitHub Actions
1. Crie um repositório no GitHub e suba o conteúdo desta pasta (inclusive `.github/`).
2. Aba **Actions → Gerar APK → Run workflow** (também roda sozinho a cada push).
3. Quando terminar, baixe o artefato **emu-hub-apk** e instale o `app-debug.apk` no celular
   (permita "instalar apps de fontes desconhecidas").

## No PC
Precisa de Node 18+, Java 17 e Android SDK (Android Studio): rode `./build-apk.sh`.

## Atualizar o hub
Coloque a nova PWA (`index.html`, `sw.js`, `manifest.json`, ícones) na pasta `pwa/` e gere de novo.
O APK de debug é assinado com a chave de debug: serve para uso pessoal. Para publicar na Play Store é preciso assinar um
`bundleRelease` com a sua própria chave.
