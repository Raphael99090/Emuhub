# EmuHub Native Android (preview)

Este módulo é o início da versão Android nativa do EmuHub, separado do app Capacitor existente.

## Stack
- Kotlin
- Jetpack Compose + Material 3
- Android Gradle Plugin 8.7.3
- Kotlin 2.0.21
- minSdk 26 / compileSdk 35

## Abrir e compilar
1. Abra a pasta `android-native` no Android Studio.
2. Aguarde a sincronização do Gradle.
3. Execute a configuração `app` em um dispositivo Android ou emulador.

É necessário ter JDK 17 e Android SDK 35 instalados.

## Estado desta prévia
- [x] Estrutura Gradle independente.
- [x] Navegação Compose: Início, Biblioteca, Sistemas e Configurações.
- [x] Primeira identidade visual escura inspirada em launchers de emuladores.
- [ ] Importação de ROMs e BIOS via Storage Access Framework.
- [ ] Persistência de biblioteca e preferências.
- [ ] Ponte JNI e integração com os núcleos C++ existentes.
- [ ] Controles virtuais, áudio, vídeo e ciclo de vida de jogo.
- [ ] Testes em dispositivos Android reais.

**Importante:** esta prévia ainda não executa jogos. O aplicativo Capacitor atual permanece intacto; este módulo não substitui o APK de produção até que a integração e os testes estejam concluídos.

## Próxima etapa
Mapear os núcleos C++ existentes e definir uma API JNI pequena para inicialização, carregamento de ROM/BIOS, execução, áudio, vídeo e encerramento.
