# Emu Hub

**Seu espaço para jogar clássicos em um só lugar — agora 100% nativo (Kotlin + C++).**

O Emu Hub é um emulador retrô independente para Android: interface em Kotlin/Jetpack Compose e núcleos de emulação em C++17 via JNI. A versão web/HTML foi aposentada e continua preservada na branch `legacy-web` (tag `web-final`).

**Importante:** o projeto não distribui ROMs, BIOS ou arquivos comerciais. Importe apenas arquivos que você tenha direito de utilizar.

## Sistemas

| Sistema | Núcleo |
|---|---|
| NES | C++ |
| Game Boy / Game Boy Color | C++ |
| Super Nintendo (sem coprocessadores) | C++ |
| Master System / Game Gear | C++ |
| Game Boy Advance | C++ |
| Neo Geo (`.neo` ou zip MAME sem criptografia; BIOS `neogeo.zip` importada uma vez) | C++ |

## Estrutura

- `android-native/` — app Android (Kotlin, Compose, GPL-3.0)
- `hub/native/` — núcleos C++ e testes (`ctest`); `hub/native/tests/parity/` compara o C++ com os núcleos JS de referência em `hub/src/cores/`
- `.github/workflows/` — CI do app (gera o APK; tags `v*` publicam a release) e dos núcleos

## Compilar

O CI faz tudo: `gradle -p android-native :app:assembleDebug` (SDK/NDK do Android, CMake 3.22.1). Para os núcleos no PC: `cmake -S hub/native -B build && cmake --build build && ctest --test-dir build`.

## Limitações conhecidas

- Sem áudio no app ainda; jogos Neo Geo com criptografia (CMC/SMA/PVC, KOF 98) não rodam.
- Núcleos validados por testes de paridade e ROMs sintéticas; falta testar mais jogos reais.
