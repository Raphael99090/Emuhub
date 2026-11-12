# Emu Hub

**Seu espaço para jogar clássicos em um só lugar.**

O Emu Hub é um projeto independente de emulação retrô que reúne biblioteca de jogos, núcleos de emulação e ferramentas de configuração em uma interface para Web e Android.

<p align="center">
  <img src="https://img.shields.io/badge/vers%C3%A3o-1.0-7c3aed" alt="Versão 1.0">
  <img src="https://img.shields.io/badge/plataforma-Web%20%7C%20Android-6d28d9" alt="Web e Android">
  <img src="https://img.shields.io/badge/licen%C3%A7a-MIT-16a34a" alt="Licença MIT">
  <img src="https://img.shields.io/badge/status-em%20desenvolvimento-f59e0b" alt="Em desenvolvimento">
</p>

## Visão geral

O objetivo do Emu Hub é oferecer uma experiência simples para organizar e executar jogos de diferentes plataformas clássicas. O projeto está em desenvolvimento contínuo: a compatibilidade e os recursos disponíveis variam de acordo com o sistema e com o jogo.

**Importante:** o projeto não distribui ROMs, BIOS ou arquivos comerciais. Importe apenas arquivos que você tenha direito de utilizar.

## Plataformas

| Sistema | Situação |
|---|---|
| Nintendo Entertainment System (NES) | Núcleo em desenvolvimento |
| Super Nintendo (SNES) | Núcleo em evolução; recursos avançados em validação |
| Game Boy / Game Boy Color | Em desenvolvimento |
| Game Boy Advance (GBA) | Em desenvolvimento |
| Master System / Game Gear | Em desenvolvimento |
| Neo Geo | Experimental; requer validação com jogos reais |

A indicação de desenvolvimento não representa compatibilidade total com todos os títulos ou revisões de hardware.

## Funcionalidades

- Biblioteca para organizar e localizar jogos.
- Interface adaptada para telas de celular e desktop.
- Controles virtuais e suporte a gamepads, conforme o sistema.
- Recursos de saves, cheats e conquistas quando suportados pelo núcleo.
- Importação de BIOS para os sistemas que exigem esses arquivos.
- Aplicação Web instalável como PWA.
- Empacotamento para Android usando Capacitor.

## Arquitetura e tecnologias

O projeto utiliza uma arquitetura híbrida que evolui gradualmente:

- **C++17:** implementação de componentes e núcleos nativos de emulação.
- **WebAssembly:** caminho de execução dos componentes C++ no navegador.
- **TypeScript / JavaScript, HTML e CSS:** interface, aplicação e integração com APIs da plataforma.
- **Python e Node.js:** ferramentas de build, empacotamento e testes.
- **Capacitor, Java e Gradle:** empacotamento Android.
- **WLA-DX e assembly 65816:** ferramentas do protótipo de jogo de luta Jarder para SNES.

Nem todos os sistemas já utilizam o backend C++/WebAssembly. Os módulos ainda em JavaScript permanecem em uso enquanto a migração e os testes de equivalência avançam. Consulte [hub/native/README.md](hub/native/README.md) para conhecer a camada nativa e seu estado atual.

## Começar

### Requisitos

- Python 3
- Node.js 20 ou superior

### Baixar o projeto

```bash
git clone https://github.com/Raphael99090/Emuhub.git
cd Emuhub
```

### Gerar a aplicação Web

```bash
python3 hub/build.py
```

O HTML gerado fica em `hub/dist/emu-hub.html`. A versão PWA é gerada em `hub/dist/pwa/`; para testar instalação e recursos do navegador, sirva essa pasta por HTTPS ou localhost.

## Testes

Os testes disponíveis podem ser executados com Node.js:

```bash
node hub/tests/hub.test.js
node hub/tests/gba/cpu.test.js
node hub/tests/gba/system.test.js
node hub/tests/snes.test.js
node hub/tests/gb.test.js
node hub/tests/sms.test.js
node hub/tests/neogeo.test.js
```

Alguns testes podem depender de ROMs de teste externas. Confira as instruções nos próprios testes antes de executá-los.

Para compilar e validar a camada nativa, consulte as instruções e dependências em [hub/native/README.md](hub/native/README.md).

## Gerar o APK Android

Além dos requisitos acima, são necessários Java 17 e Android SDK. Na raiz do projeto:

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

O APK de depuração será gerado em:

`android/app/build/outputs/apk/debug/app-debug.apk`

O repositório também possui workflows no GitHub Actions para automatizar verificações e builds. Consulte a aba [Actions](https://github.com/Raphael99090/Emuhub/actions) para acompanhar as execuções e a aba [Releases](https://github.com/Raphael99090/Emuhub/releases) para obter versões publicadas.

## Projeto Jarder

A pasta `luta/` contém um protótipo de jogo de luta para SNES com o personagem Jarder. Veja [luta/README.md](luta/README.md) para informações sobre sprites, ferramentas e compilação.

## Estrutura do repositório

```text
.github/workflows/  Automação de testes e builds
assets/             Ícones e identidade visual
hub/src/            Interface e módulos de emulação
hub/native/         Código C++ e testes nativos
hub/tests/          Testes dos módulos
hub/build.py        Geração do HTML e da PWA
scripts/            Ferramentas auxiliares e Android
luta/               Protótipo do jogo Jarder
```

## Roadmap

- [x] Aplicação Web e estrutura PWA.
- [x] Biblioteca e interface multiplataforma.
- [x] Núcleos próprios para diferentes sistemas.
- [x] Estrutura inicial de código nativo em C++.
- [ ] Ampliar compatibilidade com jogos reais.
- [ ] Aumentar a cobertura de testes e testes de paridade.
- [ ] Migrar gradualmente mais componentes para C++/WebAssembly.
- [ ] Documentar compatibilidade e limitações por sistema.

## Como contribuir

Sugestões, relatos de bugs e pull requests são bem-vindos.

Ao relatar um problema, informe:
- sistema e jogo afetados;
- navegador, versão do Android ou aparelho;
- formato do arquivo utilizado;
- passos para reproduzir o erro.

Não envie ROMs, BIOS ou outros arquivos protegidos por direitos autorais em issues ou pull requests.

## Licença

Este projeto está licenciado sob a **MIT License**. Consulte o arquivo [LICENSE](LICENSE) para ver o texto completo da licença.

---

<p align="center"><sub>Emu Hub — projeto independente de emulação retrô.</sub></p>
