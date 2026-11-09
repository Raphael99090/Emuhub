# Auditoria e manutenção — Emu Hub

## Alterações nesta proposta

- Removido `assets/debug.keystore` do estado atual do repositório.
- Adicionadas regras ao `.gitignore` para chaves privadas, builds e artefatos gerados.
- Workflow Android não copia mais uma chave privada versionada.
- Workflow executa os testes de regressão dos núcleos antes de compilar o APK.
- O workflow aceita o Secret `ANDROID_DEBUG_KEYSTORE_BASE64` para restaurar uma chave persistente fora do Git.
- Corrigida a seleção/cópia da PWA para `www/`, com cópia recursiva e erro claro se a PWA não existir.
- Documentadas as dependências Python do importador de sprites do Jarder: Pillow, NumPy e SciPy.

## Ação de segurança ainda necessária

Excluir um arquivo em um commit novo **não apaga suas versões dos commits antigos**. Como a chave esteve no repositório, considere-a comprometida. Se ela foi usada para assinar APKs distribuídos, gere uma nova chave e revise o histórico Git/solicite a remoção do objeto sensível do histórico antes de voltar a publicar o repositório.

Para manter a capacidade de instalar atualizações sem desinstalar o app, configure uma chave de depuração persistente como Secret do GitHub `ANDROID_DEBUG_KEYSTORE_BASE64` (conteúdo Base64 do arquivo keystore). Se o Secret não estiver configurado, o Gradle gera uma chave local no runner; APKs de execuções diferentes poderão ter assinaturas diferentes e exigir reinstalação.

## Validação

A proposta adiciona os testes existentes ao workflow de CI. Eles ainda precisam ser executados pelo GitHub Actions; não foi feita compilação local nem execução dos testes nesta sessão.

O teste de compilação do Jarder também depende de WLA-DX instalado. O script de geração depende dos arquivos de arte em `luta/art/src/` e das dependências listadas em `luta/tools/requirements.txt`.

## Próximas verificações recomendadas

1. Executar o workflow e corrigir qualquer regressão reportada.
2. Configurar uma chave de assinatura nova e persistente nos Secrets.
3. Fazer uma auditoria funcional com ROMs de teste legais e BIOS fornecida pelo usuário, especialmente Neo Geo (o próprio README marca a renderização de sprites/camada fixa como não verificada em jogo real).
4. Compilar e executar `luta/jarder.sfc` num emulador SNES de referência, além do núcleo interno do Emu Hub.
