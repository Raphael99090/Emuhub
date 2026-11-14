# EmuHub Native Android

Módulo Android nativo em Kotlin + Jetpack Compose, separado do app Capacitor existente.

## Stack
- Kotlin 2.0.21
- Jetpack Compose + Material 3
- Android Gradle Plugin 8.7.3
- Android NDK / CMake 3.22.1
- Núcleo C++17 existente em `hub/native`

## Compilar
Abra a pasta `android-native` no Android Studio, com JDK 17, Android SDK 35, NDK e CMake 3.22.1 instalados. Execute a configuração `app`.

Também há CI em `.github/workflows/android-native.yml`, que gera o APK debug como artefato da branch.

## O que já está ligado
- Interface Compose: Início, Biblioteca, Sistemas e Configurações.
- Seletor de arquivos Android (Storage Access Framework) para importar uma ROM.
- Ponte JNI para a ABI C++ existente.
- Seleção dos motores NES, Game Boy / Game Boy Color e SNES.
- Carregamento da ROM e chamada de execução de um frame pelo núcleo nativo.
- Consulta do buffer de vídeo pelo JNI.

## Limitações desta prévia
- Ainda não existe loop contínuo de renderização, tela de jogo ou áudio Android.
- Ainda não há controles virtuais nem mapeamento de gamepad.
- O núcleo C++ atual só expõe NES, GB/GBC e SNES nesta ABI. GBA, SMS/GG e Neo Geo continuam nos núcleos JavaScript da versão anterior.
- Importação de BIOS, persistência da biblioteca e save states na interface nativa ainda não foram implementados.
- O APK nativo é uma prévia técnica, não substitui a versão Capacitor de produção.

## Próximos passos
1. Adicionar loop de emulação e renderização no Surface/Compose.
2. Integrar áudio com AudioTrack e controles touchscreen/gamepad.
3. Persistir biblioteca, preferências, saves e SRAM.
4. Portar os outros núcleos com testes de paridade antes de desativar seus equivalentes JavaScript.
