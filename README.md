<div align="center">
  <img src="assets/emu-hub-logo.svg" alt="Emu Hub" width="420">
  <p><strong>Um hub de emulação retrô, feito com código próprio.</strong></p>
  <p>Biblioteca de jogos, emuladores, saves, cheats e controles em uma interface única.</p>
</div>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-em%20desenvolvimento-8b5cf6">
  <img alt="Interface" src="https://img.shields.io/badge/interface-HTML%20%2F%20CSS%20%2F%20JS-7c3aed">
  <img alt="Android" src="https://img.shields.io/badge/Android-APK-3ddc84">
  <img alt="PWA" src="https://img.shields.io/badge/Web-PWA-6366f1">
</p>

## Sobre

O **Emu Hub** é um projeto de emulação multiplataforma que reúne diferentes sistemas clássicos em uma biblioteca simples de usar. Os núcleos são implementados no próprio projeto em JavaScript; a interface pode ser instalada como PWA e empacotada para Android com Capacitor.

O projeto está em desenvolvimento. O nível de compatibilidade varia por sistema e por jogo: resultados de testes automatizados não significam compatibilidade total com todo o catálogo comercial.

## Sistemas

| Sistema | Estado informado pelo projeto |
|---|---|
| NES | Em desenvolvimento ativo |
| SNES | Beta; alguns recursos especiais ainda experimentais |
| Game Boy / Game Boy Color | Beta |
| Master System / Game Gear | Beta |
| Game Boy Advance | Beta |
| Neo Geo | Beta; precisa de validação com jogos reais |

Consulte os READMEs de cada módulo para detalhes e limitações atualizadas.

## Recursos

- Biblioteca de jogos com capas e busca.
- Controles virtuais e suporte a gamepad.
- Save states e opções de continuar jogando.
- Cheats, quando suportados pelo núcleo.
- Integração com RetroAchievements.
- Suporte a BIOS e arquivos selecionados pelo usuário, quando exigidos pelo sistema.
- PWA instalável e pacote Android via Capacitor.

**ROMs, BIOS e arquivos de jogos não são fornecidos pelo projeto.** Use somente arquivos que você tenha direito de utilizar.

## Tecnologias

- JavaScript, HTML e CSS para a aplicação e os núcleos atuais.
- Python para empacotamento e ferramentas de assets.
- Node.js para testes e ferramentas de build.
- Capacitor, Java e Gradle para gerar o APK Android.
- WLA-DX e assembly 65816 para o projeto experimental de luta do Jarder.

> Uma futura migração de partes dos núcleos para C++/WebAssembly está em avaliação. Ela não faz parte da arquitetura atual e deve ser feita gradualmente, mantendo os testes de compatibilidade.

## Executar localmente

Pré-requisitos: Python 3 e Node.js 20 ou superior.

```bash
git clone https://github.com/Raphael99090/Emuhub.git
cd Emuhub

# Gerar o HTML único e a PWA
python3 hub/build.py
```

Abra `hub/dist/emu-hub.html` para testar a versão em arquivo único. Para instalar/validar a PWA, sirva `hub/dist/pwa/` por HTTPS ou localhost.

## Testes

Depois de gerar o hub:

```bash
node hub/tests/hub.test.js
node hub/tests/gba/cpu.test.js
node hub/tests/gba/system.test.js
node hub/tests/snes.test.js
node hub/tests/gb.test.js
node hub/tests/sms.test.js
node hub/tests/neogeo.test.js
```

Alguns testes opcionais usam ROMs de teste externas. Veja os comentários e READMEs dos testes para saber como configurá-las.

## Gerar o APK Android

Com Node.js 20, Java 17 e Android SDK instalados:

```bash
npm install
python3 hub/build.py
node scripts/copiar-www.js
npx cap add android
node scripts/pos-android.js
npx cap sync android
cd android
./gradlew assembleDebug
```

O APK de depuração é gerado em:

`android/app/build/outputs/apk/debug/app-debug.apk`

O workflow do GitHub Actions também automatiza os testes e a geração do APK. Para preservar a assinatura entre builds de depuração, configure uma keystore própria como Secret do GitHub; não versione chaves privadas.

## Projeto Jarder

A pasta `luta/` contém um protótipo de jogo de luta para SNES com o personagem Jarder. Consulte [luta/README.md](luta/README.md) para dependências, geração de sprites e compilação com WLA-DX.

## Estrutura

```text
hub/
  src/
    cores/       Núcleos dos sistemas
    css/         Estilos da interface
    data/        Dados auxiliares
    pwa/         Manifesto, service worker e ícones
  tests/         Testes automatizados
  build.py       Empacotador da aplicação
luta/            Protótipo SNES do Jarder
scripts/         Ferramentas do projeto e do APK
assets/          Identidade visual e assets Android
.github/
  workflows/     CI e geração do APK
```

## Estado e roadmap

- [x] Hub web/PWA e estrutura de biblioteca.
- [x] Núcleos próprios para vários sistemas.
- [x] Ferramentas de testes automatizados.
- [ ] Ampliar a compatibilidade com jogos reais e documentar limitações por sistema.
- [ ] Melhorar cobertura de testes e validação contínua.
- [ ] Modernizar identidade visual e documentação.
- [ ] Avaliar migração incremental de núcleos para C++/WebAssembly.

## Contribuir

Sugestões, relatos de bugs e pull requests são bem-vindos. Ao reportar um problema, informe o sistema, o navegador/aparelho, o nome e formato do arquivo de jogo (sem anexar ROMs protegidas por direitos autorais) e os passos para reproduzir.

## Licença

A licença do projeto deve ser consultada no arquivo de licença do repositório. Se ainda não houver um arquivo LICENSE, o código não deve ser presumido como open source sob uma licença específica.

---

<div align="center">
  <sub>Emu Hub — projeto independente de emulação retrô.</sub>
</div>

## Arquitetura híbrida em evolução

O plano de evolução mantém a interface em HTML/CSS/JavaScript e introduz núcleos C++17 compilados para WebAssembly. O contrato inicial e as instruções de build ficam em [hub/native/README.md](hub/native/README.md). **A fundação C++ ainda não é um núcleo de emulação funcional**; os emuladores JavaScript continuam sendo o backend ativo até que cada port passe por testes de equivalência.
