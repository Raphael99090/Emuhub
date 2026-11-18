package com.rapzin.emuhub.nativeapp

import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.MotionEvent
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.input.pointer.pointerInteropFilter
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val Ink = Color(0xFF090B12)
private val Panel = Color(0xFF141925)
private val Purple = Color(0xFF9A78FF)
private val Muted = Color(0xFF929BAD)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { EmuHubApp() }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean = InputState.onKey(event) || super.dispatchKeyEvent(event)
    override fun dispatchGenericMotionEvent(ev: MotionEvent): Boolean = InputState.onMotion(ev) || super.dispatchGenericMotionEvent(ev)
}

private data class ConsoleItem(val id: Int, val short: String, val full: String, val native: Boolean)
internal data class GameEntry(val title: String, val console: Int, val path: String, val added: Long = 0L, val played: Long = 0L, val favorite: Boolean = false)

@Composable
private fun EmuHubApp() {
    var page by remember { mutableStateOf("Início") }
    var selectedConsole by remember { mutableIntStateOf(NativeEmulator.NES) }
    var loadedName by remember { mutableStateOf<String?>(null) }
    val games = remember { mutableStateListOf<GameEntry>() }
    val context = LocalContext.current
    LaunchedEffect(Unit) {
        val saved = context.getSharedPreferences("emuhub_library", 0).getString("games", "[]") ?: "[]"
        runCatching {
            val array = JSONArray(saved)
            for (i in 0 until array.length()) {
                val item = array.getJSONObject(i)
                val game = GameEntry(item.getString("title"), item.getInt("console"), item.getString("path"), item.optLong("added", 0L), item.optLong("played", 0L), item.optBoolean("fav", false))
                if (game.path.startsWith("content://") || File(game.path).exists()) games.add(game)
            }
        }
    }
    var status by remember { mutableStateOf(if (NativeEmulator.available) "Núcleo C++ carregado · ABI ${NativeEmulator.nativeAbi()}" else "Núcleo nativo indisponível neste build") }
    val scope = rememberCoroutineScope()
    remember { NativeEmulator.neoBiosFile = File(context.filesDir, "bios/neogeo.zip") }
    val consoles = remember {
        listOf(
            ConsoleItem(NativeEmulator.NES, "NES", "Nintendo Entertainment System", true),
            ConsoleItem(NativeEmulator.GAME_BOY, "GB / GBC", "Game Boy / Game Boy Color", true),
            ConsoleItem(NativeEmulator.SNES, "SNES", "Super Nintendo", true),
            ConsoleItem(NativeEmulator.GBA, "GBA", "Game Boy Advance", true),
            ConsoleItem(NativeEmulator.MASTER_SYSTEM, "SMS", "Sega Master System", true),
            ConsoleItem(NativeEmulator.GAME_GEAR, "Game Gear", "Sega Game Gear", true),
            ConsoleItem(NativeEmulator.NEO_GEO, "Neo Geo", "SNK Neo Geo (.neo ou zip MAME + BIOS neogeo.zip)", true)
        )
    }
    fun playGame(game: GameEntry) {
        val romBytes = readRom(context, game.path)
        val code = if (romBytes != null) NativeEmulator.load(game.console, romBytes) else -101
        if (code == 0) {
            selectedConsole = game.console; loadedName = game.title; page = "Jogar"
            val i = games.indexOfFirst { it.path == game.path }
            if (i >= 0) { games[i] = games[i].copy(played = System.currentTimeMillis()); saveLibrary(context, games.toList()) }
        } else status = if (code == NativeEmulator.NEO_NEEDS_BIOS) "Neo Geo precisa da BIOS: coloque o neogeo.zip numa pasta escaneada ou abra-o em + com Neo Geo selecionado."
        else if (game.console == NativeEmulator.NEO_GEO) "Neo Geo: ${NativeEmulator.nativeNeoError()}" else "Falha ao abrir ${game.title} (código $code)"
    }
    var folders by remember { mutableStateOf(AppSettings.folders(context)) }
    fun scanFolders(list: List<String>) {
        scope.launch {
            status = "Escaneando pastas..."
            val result = withContext(Dispatchers.IO) {
                val all = ArrayList<FoundRom>(); val bios = ArrayList<String>()
                list.forEach { f -> runCatching { scanTree(context, Uri.parse(f)) }.getOrNull()?.let { all += it.roms; bios += it.biosUris } }
                for (b in bios) { readRom(context, b)?.let { NativeEmulator.load(NativeEmulator.NEO_GEO, it) } }
                all to bios.size
            }
            val now = System.currentTimeMillis()
            var added = 0
            result.first.forEach { r ->
                if (games.none { it.path == r.uri }) { games.add(GameEntry(r.name, r.console, r.uri, added = now)); added++ }
            }
            // remove da biblioteca jogos de pastas que sumiram do disco
            saveLibrary(context, games.toList())
            status = "Pasta escaneada: ${result.first.size} jogos encontrados, $added novos" + if (result.second > 0) " · BIOS Neo Geo instalada" else ""
        }
    }
    val folderPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri: Uri? ->
        if (uri != null) {
            runCatching { context.contentResolver.takePersistableUriPermission(uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION) }
            folders = (folders + uri.toString()).distinct()
            AppSettings.setFolders(context, folders)
            scanFolders(listOf(uri.toString()))
        }
    }
    val actions = remember {
        GameActions(
            onFavorite = { g ->
                val i = games.indexOfFirst { it.path == g.path }
                if (i >= 0) { games[i] = games[i].copy(favorite = !games[i].favorite); saveLibrary(context, games.toList()) }
            },
            onRemove = { g ->
                games.removeAll { it.path == g.path }
                if (!g.path.startsWith("content://")) runCatching { File(g.path).delete() }
                saveLibrary(context, games.toList())
            }
        )
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) {
            scope.launch {
                status = "Lendo ROM..."
                detectConsole(uri.lastPathSegment?.substringAfterLast('/') ?: "")?.let { if (it != NativeEmulator.NEO_GEO || selectedConsole == NativeEmulator.NEO_GEO || uri.lastPathSegment?.endsWith(".neo", true) == true) selectedConsole = it }
                val result = withContext(Dispatchers.IO) {
                    runCatching {
                        context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                            ?: error("Não foi possível abrir o arquivo")
                    }
                }
                result.onSuccess { bytes ->
                    val imported = withContext(Dispatchers.IO) {
                        val folder = File(context.filesDir, "roms").apply { mkdirs() }
                        val safeName = (uri.lastPathSegment?.substringAfterLast('/') ?: "game.rom").replace(Regex("[^A-Za-z0-9._-]"), "_")
                        val target = File(folder, "${System.currentTimeMillis()}_$safeName")
                        target.writeBytes(bytes)
                        target.absolutePath
                    }
                    val code = withContext(Dispatchers.Default) { NativeEmulator.load(selectedConsole, bytes) }
                    if (code == NativeEmulator.BIOS_INSTALLED) {
                        status = "BIOS do Neo Geo instalada. Agora abra um jogo (.neo ou zip)."
                        java.io.File(imported).delete()
                    } else if (code == 0) {
                        loadedName = uri.lastPathSegment?.substringAfterLast('/') ?: "ROM carregada"
                        games.removeAll { it.title == loadedName && it.console == selectedConsole }
                        games.add(GameEntry(loadedName!!, selectedConsole, imported, added = System.currentTimeMillis()))
                        saveLibrary(context, games.toList())
                        status = "ROM salva na biblioteca · ${bytes.size / 1024} KB"
                    } else {
                        status = if (code == NativeEmulator.NEO_NEEDS_BIOS && selectedConsole == NativeEmulator.NEO_GEO) "Neo Geo precisa da BIOS: abra primeiro o neogeo.zip."
                        else if (selectedConsole == NativeEmulator.NEO_GEO) "Neo Geo: ${NativeEmulator.nativeNeoError()}"
                        else "O núcleo recusou a ROM (código $code). Confira o formato e o sistema selecionado."
                    }
                }.onFailure { status = "Falha ao ler ROM: ${it.message}" }
            }
        }
    }

    MaterialTheme(colorScheme = darkColorScheme(
        primary = Purple, background = Ink, surface = Panel,
        onBackground = Color.White, onSurface = Color.White
    )) {
        Scaffold(
            containerColor = Ink,
            bottomBar = {
                NavigationBar(containerColor = Panel, contentColor = Color.White) {
                    listOf(
                        "Início" to Icons.Rounded.Home,
                        "Biblioteca" to Icons.Rounded.GridView,
                        "Sistemas" to Icons.Rounded.SportsEsports,
                        "Ajustes" to Icons.Rounded.Settings
                    ).forEach { (label, icon) ->
                        NavigationBarItem(
                            selected = page == label,
                            onClick = { page = label },
                            icon = { Icon(icon, contentDescription = label) },
                            label = { Text(label, fontSize = 10.sp) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = Purple,
                                indicatorColor = Purple.copy(alpha = .16f),
                                selectedTextColor = Purple
                            )
                        )
                    }
                }
            }
        ) { padding ->
            when (page) {
                "Início" -> HomeScreen(Modifier.padding(padding), status, games, onBrowse = { page = "Biblioteca" }, onPlay = { playGame(it) })
                "Biblioteca" -> GamesScreen(
                    Modifier.padding(padding), games,
                    systems = consoles.filter { it.native }.map { it.id to it.short },
                    selectedSystem = selectedConsole,
                    onSelectSystem = { selectedConsole = it },
                    onImport = { picker.launch(arrayOf("*/*")) },
                    onImportFolder = { folderPicker.launch(null) },
                    onPlay = { playGame(it) },
                    actions = actions,
                    status = status
                )
                "Jogar" -> GameScreen(
                    Modifier.padding(padding), loadedName ?: "Jogo", selectedConsole,
                    onBack = { page = "Biblioteca" },
                    onReset = { NativeEmulator.nativeReset() }
                )
                "Sistemas" -> SystemsScreen(Modifier.padding(padding), consoles) { selectedConsole = it; page = "Biblioteca" }
                else -> SettingsScreen(
                    Modifier.padding(padding), status, folders,
                    onAddFolder = { folderPicker.launch(null) },
                    onRescan = { scanFolders(folders) },
                    onRemoveFolder = { f -> folders = folders - f; AppSettings.setFolders(context, folders) }
                )
            }
        }
    }
}

@Composable
private fun HomeScreen(
    modifier: Modifier = Modifier, status: String, games: List<GameEntry>,
    onBrowse: () -> Unit, onPlay: (GameEntry) -> Unit
) {
    LazyColumn(
        modifier.fillMaxSize().padding(horizontal = 20.dp),
        contentPadding = PaddingValues(top = 24.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp)
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("EMU HUB", color = Purple, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                    Text("Seus jogos.", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
                    Text("Sua coleção retro em um só lugar.", color = Muted, fontSize = 13.sp)
                }
                Surface(color = Panel, shape = RoundedCornerShape(16.dp)) {
                    Icon(Icons.Rounded.SportsEsports, null, Modifier.padding(12.dp), tint = Purple)
                }
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Minha coleção", Modifier.weight(1f), fontSize = 20.sp, fontWeight = FontWeight.Bold)
                TextButton(onClick = onBrowse) { Text("Adicionar jogo", color = Purple) }
            }
        }
        if (games.isEmpty()) {
            item {
                Surface(color = Panel, shape = RoundedCornerShape(22.dp), modifier = Modifier.fillMaxWidth().clickable { onBrowse() }) {
                    Column(Modifier.padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Rounded.AddToPhotos, null, tint = Purple, modifier = Modifier.size(42.dp))
                        Text("Sua biblioteca está vazia", fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
                        Text("Importe ROMs para montar seu carrossel de jogos.", color = Muted, fontSize = 12.sp)
                        Button(onClick = onBrowse, modifier = Modifier.padding(top = 14.dp), colors = ButtonDefaults.buttonColors(containerColor = Purple)) { Text("Importar jogos") }
                    }
                }
            }
        } else {
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(end = 8.dp)) {
                    items(games, key = { "${it.console}-${it.title}" }) { game ->
                        val artwork = when (game.console) {
                            NativeEmulator.NES -> listOf(Color(0xFFB64D3D), Color(0xFF321C35), Color(0xFF111827))
                            NativeEmulator.GAME_BOY -> listOf(Color(0xFF739B67), Color(0xFF263D39), Color(0xFF111827))
                            else -> listOf(Color(0xFF526CCB), Color(0xFF32244F), Color(0xFF111827))
                        }
                        Column(Modifier.width(174.dp).clickable { onPlay(game) }) {
                            Box(
                                Modifier.fillMaxWidth().height(218.dp)
                                    .background(Brush.linearGradient(artwork), RoundedCornerShape(18.dp))
                                    .padding(14.dp)
                            ) {
                                Surface(color = Color.Black.copy(alpha = .28f), shape = RoundedCornerShape(8.dp), modifier = Modifier.align(Alignment.TopStart)) {
                                    Text(NativeEmulator.label(game.console), modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp), color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                                }
                                Icon(Icons.Rounded.SportsEsports, null, tint = Color.White.copy(alpha = .72f), modifier = Modifier.align(Alignment.TopEnd).size(22.dp))
                                Text(game.title.take(2).uppercase(), modifier = Modifier.align(Alignment.Center), color = Color.White.copy(alpha = .28f), fontSize = 64.sp, fontWeight = FontWeight.Black)
                                Column(Modifier.align(Alignment.BottomStart)) {
                                    Text(game.title.take(22), color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, maxLines = 2)
                                    Text("TOQUE PARA JOGAR", color = Color.White.copy(alpha = .78f), fontSize = 9.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 5.dp))
                                }
                            }
                            Text(game.title, modifier = Modifier.padding(top = 9.dp), maxLines = 1, fontWeight = FontWeight.Bold)
                            Text("Adicionado à biblioteca", color = Muted, fontSize = 10.sp)
                        }
                    }
                }
            }
        }
        item { SectionTitle("Estado do emulador") }
        item {
            Surface(color = Panel, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (NativeEmulator.available) Icons.Rounded.CheckCircle else Icons.Rounded.Warning, null, tint = if (NativeEmulator.available) Color(0xFF6DDBA7) else Color(0xFFFFC06D))
                    Text(status, Modifier.padding(start = 12.dp), color = Muted, fontSize = 12.sp)
                }
            }
        }
    }
}

@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
private fun GameScreen(modifier: Modifier, gameName: String, console: Int, onBack: () -> Unit, onReset: () -> Unit) {
    val context = LocalContext.current
    val saveDir = remember { File(context.filesDir, "saves").apply { mkdirs() } }
    val key = remember(gameName, console) { "${console}_" + gameName.replace(Regex("[^A-Za-z0-9._-]"), "_") }
    val sramFile = File(saveDir, "$key.sav")
    val stateFile = File(saveDir, "$key.state")
    var message by remember { mutableStateOf<String?>(null) }
    val audio = remember(console) { GameAudio() }
    val view = androidx.compose.ui.platform.LocalView.current
    val smooth = remember { AppSettings.smooth(context) }
    var speed by remember { mutableIntStateOf(1) }
    var rewinding by remember { mutableStateOf(false) }
    val snapshots = remember { ArrayDeque<ByteArray>() }
    var snapshotBytes by remember { mutableIntStateOf(0) }
    val cheatsFile = File(saveDir, "$key.cheats")
    var cheatText by remember(key) { mutableStateOf(Cheats.load(cheatsFile)) }
    var cheatDialog by remember { mutableStateOf(false) }
    var cheatError by remember { mutableStateOf<String?>(null) }
    DisposableEffect(key) {
        InputState.console = console; InputState.gameActive = true; InputState.touch = 0; InputState.pad = 0
        if (NativeEmulator.available) NativeEmulator.nativeVolume(AppSettings.volume(context))
        if (AppSettings.keepOn(context)) view.keepScreenOn = true
        if (NativeEmulator.available) {
            if (cheatText.isNotBlank()) runCatching { Cheats.apply(Cheats.parse(cheatText, console)) } else NativeEmulator.nativeCheatsClear()
        }
        // restaura o save de bateria e grava de volta ao sair
        if (NativeEmulator.available && NativeEmulator.nativeSramBattery() == 1 && sramFile.isFile) {
            runCatching { NativeEmulator.nativeSramSet(sramFile.readBytes()) }
        }
        onDispose {
            InputState.gameActive = false; InputState.touch = 0; InputState.pad = 0; InputState.push()
            view.keepScreenOn = false
            audio.release()
            if (NativeEmulator.available && NativeEmulator.nativeSramBattery() == 1) {
                runCatching { NativeEmulator.nativeSramGet()?.let { sramFile.writeBytes(it) } }
            }
        }
    }
    var frameBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var running by remember { mutableStateOf(true) }
    var frameError by remember { mutableStateOf<String?>(null) }
    var frameCount by remember { mutableIntStateOf(0) }

    LaunchedEffect(running, console) {
        if (running && NativeEmulator.available) {
            while (isActive) {
                val rendered = withContext(Dispatchers.Default) {
                    var result = 0
                    if (rewinding && snapshots.isNotEmpty()) {
                        val snap = snapshots.removeLast(); snapshotBytes -= snap.size
                        NativeEmulator.nativeStateLoad(snap)
                    } else if (!rewinding && speed == 1 && frameCount % 4 == 0 && snapshotBytes < 48_000_000) {
                        NativeEmulator.nativeStateSave()?.let { snapshots.addLast(it); snapshotBytes += it.size }
                        if (snapshotBytes >= 48_000_000) { snapshots.removeFirst().let { snapshotBytes -= it.size } }
                    }
                    for (k in 1 until speed) { result = NativeEmulator.nativeRunFrame(); if (result != 0) break }   // avanço rápido: quadros extras sem som
                    if (result == 0) result = NativeEmulator.nativeRunFrame()
                    if (result == 0 && speed == 1 && !rewinding) audio.push(NativeEmulator.nativeAudio())
                    if (result != 0) null else {
                        val width = NativeEmulator.nativeWidth()
                        val height = NativeEmulator.nativeHeight()
                        val pixels = NativeEmulator.nativeFrame()
                        if (pixels == null || width <= 0 || height <= 0 || pixels.size < width * height) null
                        else Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
                    }
                }
                if (rendered == null) {
                    frameError = "O núcleo não conseguiu produzir um frame."
                    running = false
                } else {
                    frameBitmap = rendered
                }
                frameCount++
                if (frameCount % 600 == 0 && NativeEmulator.nativeSramBattery() == 1) {
                    withContext(Dispatchers.IO) { runCatching { NativeEmulator.nativeSramGet()?.let { sramFile.writeBytes(it) } } }
                }
                delay(16)
            }
        }
    }

    if (cheatDialog) {
        AlertDialog(
            onDismissRequest = { cheatDialog = false },
            title = { Text("Cheats") },
            text = {
                Column {
                    Text("Um código por linha: ENDEREÇO:VALOR (hex)" + if (console == NativeEmulator.NES) " ou Game Genie." else ".", color = Muted, fontSize = 12.sp)
                    OutlinedTextField(cheatText, { cheatText = it; cheatError = null }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), minLines = 3)
                    cheatError?.let { Text(it, color = Color(0xFFFF8A8A), fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp)) }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    runCatching {
                        if (cheatText.isBlank()) NativeEmulator.nativeCheatsClear() else Cheats.apply(Cheats.parse(cheatText, console))
                        runCatching { cheatsFile.writeText(cheatText) }
                    }.onSuccess { cheatDialog = false; message = if (cheatText.isBlank()) "Cheats desligados" else "Cheats ativados" }
                        .onFailure { cheatError = it.message }
                }) { Text("Aplicar") }
            },
            dismissButton = { TextButton(onClick = { cheatDialog = false }) { Text("Fechar") } }
        )
    }
    Column(modifier.fillMaxSize().padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { running = false; onBack() }) { Icon(Icons.Rounded.ArrowBack, "Voltar") }
            Column(Modifier.weight(1f)) {
                Text(gameName, fontWeight = FontWeight.Bold, maxLines = 1)
                Text(NativeEmulator.label(console), color = Muted, fontSize = 11.sp)
            }
            IconButton(onClick = {
                val st = NativeEmulator.nativeStateSave()
                message = if (st != null) { runCatching { stateFile.writeBytes(st) }.fold({ "Estado salvo" }, { "Falha ao salvar" }) } else "Núcleo sem estado salvo"
            }) { Icon(Icons.Rounded.Save, "Salvar estado") }
            IconButton(onClick = {
                message = if (!stateFile.isFile) "Nenhum estado salvo" else if (NativeEmulator.nativeStateLoad(stateFile.readBytes()) == 0) "Estado carregado" else "Estado incompatível"
            }) { Icon(Icons.Rounded.Download, "Carregar estado") }
            Icon(Icons.Rounded.FastRewind, "Rebobinar (segure)", tint = if (rewinding) Purple else Color.White,
                modifier = Modifier.size(48.dp).padding(12.dp).pointerInteropFilter { ev ->
                    when (ev.actionMasked) {
                        MotionEvent.ACTION_DOWN -> rewinding = true
                        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> rewinding = false
                    }
                    true
                })
            IconButton(onClick = { cheatDialog = true }) { Icon(Icons.Rounded.AutoFixHigh, "Cheats", tint = if (cheatText.isNotBlank()) Purple else Color.White) }
            IconButton(onClick = { speed = if (speed == 1) 3 else 1; message = if (speed == 3) "Avanço rápido 3x (sem som)" else "Velocidade normal" }) { Icon(Icons.Rounded.FastForward, "Avanço rápido", tint = if (speed > 1) Purple else Color.White) }
            IconButton(onClick = onReset) { Icon(Icons.Rounded.Refresh, "Reiniciar") }
            IconButton(onClick = { running = !running }) { Icon(if (running) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, "Pausar") }
        }
        Box(
            Modifier.fillMaxWidth().weight(1f).background(Color.Black, RoundedCornerShape(14.dp)),
            contentAlignment = Alignment.Center
        ) {
            val bitmap = frameBitmap
            if (bitmap != null) {
                Image(bitmap.asImageBitmap(), contentDescription = "Tela do jogo", modifier = Modifier.fillMaxWidth(), contentScale = ContentScale.Fit,
                    filterQuality = if (smooth) androidx.compose.ui.graphics.FilterQuality.Medium else androidx.compose.ui.graphics.FilterQuality.None)
            } else {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = Purple)
                    Text(frameError ?: "Iniciando jogo...", color = Muted, modifier = Modifier.padding(top = 12.dp))
                }
            }
        }
        GameControls(console)
        Text(message ?: "Toque, teclado ou controle Bluetooth/USB", color = Muted, fontSize = 10.sp)
    }
}

@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
private fun GameControls(console: Int) {
    var pressed by remember { mutableIntStateOf(0) }
    val view = androidx.compose.ui.platform.LocalView.current
    val haptics = remember { AppSettings.haptics(view.context) }
    fun update(bit: Int, down: Boolean) {
        pressed = if (down) pressed or bit else pressed and bit.inv()
        InputState.touch = pressed
        InputState.push()
    }
    @Composable
    fun PadButton(label: String, bit: Int, modifier: Modifier = Modifier) {
        Box(
            modifier.size(54.dp).background(Panel, CircleShape).pointerInteropFilter { event ->
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                        update(bit, true)
                        if (haptics) view.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP)
                    }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_POINTER_UP -> update(bit, false)
                }
                true
            },
            contentAlignment = Alignment.Center
        ) { Text(label, color = Color.White, fontWeight = FontWeight.Bold) }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            PadButton("↑", 16)
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { PadButton("←", 64); PadButton("↓", 32); PadButton("→", 128) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            PadButton("SELECT", if (console == NativeEmulator.SNES) 256 else 4, Modifier)
            PadButton("START", 8, Modifier)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (console == NativeEmulator.GBA) { PadButton("L", 1024); PadButton("R", 2048) }
            if (console == NativeEmulator.NEO_GEO) { PadButton("D", 512); PadButton("C", 256) }
            PadButton("B", 2)
            PadButton("A", 1)
        }
    }
}

@Composable
private fun SystemsScreen(modifier: Modifier = Modifier, consoles: List<ConsoleItem>, onOpen: (Int) -> Unit) {
    LazyColumn(modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("Sistemas", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold) }
        item { Text("Compatibilidade do núcleo nativo", color = Muted) }
        items(consoles) { item ->
            Surface(color = Panel, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth().clickable { if (item.native) onOpen(item.id) }) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.Memory, null, tint = Purple)
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text(item.short, fontWeight = FontWeight.Bold)
                        Text(item.full, color = Muted, fontSize = 11.sp)
                    }
                    Text(if (item.native) "C++" else "Em breve", color = if (item.native) Color(0xFF6DDBA7) else Muted, fontSize = 11.sp)
                }
            }
        }
    }
}

@Composable
private fun SettingsScreen(
    modifier: Modifier = Modifier, status: String, folders: List<String>,
    onAddFolder: () -> Unit, onRescan: () -> Unit, onRemoveFolder: (String) -> Unit
) {
    val context = LocalContext.current
    var volume by remember { mutableFloatStateOf(AppSettings.volume(context)) }
    var haptics by remember { mutableStateOf(AppSettings.haptics(context)) }
    var keepOn by remember { mutableStateOf(AppSettings.keepOn(context)) }
    var smooth by remember { mutableStateOf(AppSettings.smooth(context)) }
    LazyColumn(modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("Ajustes", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold) }
        item {
            Surface(color = Panel, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Pastas de ROMs", fontWeight = FontWeight.Bold)
                    Text("Escaneadas por subpastas. O neogeo.zip achado nelas vira a BIOS do Neo Geo.", color = Muted, fontSize = 12.sp)
                    folders.forEach { f ->
                        Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.Folder, null, tint = Purple)
                            Text(folderLabel(f), Modifier.weight(1f).padding(horizontal = 8.dp), fontSize = 12.sp, maxLines = 1)
                            IconButton(onClick = { onRemoveFolder(f) }) { Icon(Icons.Rounded.Close, "Remover pasta", tint = Muted) }
                        }
                    }
                    Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = onAddFolder, colors = ButtonDefaults.buttonColors(containerColor = Purple)) { Text("Adicionar pasta") }
                        if (folders.isNotEmpty()) OutlinedButton(onClick = onRescan) { Text("Reescanear") }
                    }
                }
            }
        }
        item {
            Surface(color = Panel, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Jogo", fontWeight = FontWeight.Bold)
                    Text("Volume ${(volume * 100).toInt()}%", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
                    Slider(value = volume, onValueChange = { volume = it }, onValueChangeFinished = { AppSettings.setVolume(context, volume) })
                    SettingSwitch("Vibração nos botões", haptics) { haptics = it; AppSettings.setHaptics(context, it) }
                    SettingSwitch("Manter a tela ligada", keepOn) { keepOn = it; AppSettings.setKeepOn(context, it) }
                    SettingSwitch("Suavizar imagem (filtro linear)", smooth) { smooth = it; AppSettings.setSmooth(context, it) }
                }
            }
        }
        item {
            Surface(color = Panel, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Núcleo C++", fontWeight = FontWeight.Bold)
                    Text(status, color = Muted, fontSize = 12.sp)
                    Text("NES, Game Boy/GBC, SNES, Master System, Game Gear, GBA e Neo Geo.", color = Muted, fontSize = 12.sp)
                    Text("Neo Geo: abra o neogeo.zip uma vez (ou deixe-o numa pasta escaneada); jogos criptografados ainda não rodam.", color = Muted, fontSize = 12.sp)
                }
            }
        }
    }
}

@Composable
private fun SettingSwitch(label: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), fontSize = 13.sp)
        Switch(checked = value, onCheckedChange = onChange)
    }
}

@Composable
private fun SectionTitle(title: String) {
    Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold)
}

/** Saída de áudio mono em float (todos os núcleos geram mono). Escrita não bloqueante para não travar o quadro. */
private class GameAudio {
    private val rate = if (NativeEmulator.available) NativeEmulator.nativeSampleRate().takeIf { it > 0 } ?: 48000 else 48000
    private val track: android.media.AudioTrack? = runCatching {
        val min = android.media.AudioTrack.getMinBufferSize(rate, android.media.AudioFormat.CHANNEL_OUT_MONO, android.media.AudioFormat.ENCODING_PCM_FLOAT)
        android.media.AudioTrack.Builder()
            .setAudioAttributes(android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_GAME).setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setAudioFormat(android.media.AudioFormat.Builder().setEncoding(android.media.AudioFormat.ENCODING_PCM_FLOAT).setSampleRate(rate).setChannelMask(android.media.AudioFormat.CHANNEL_OUT_MONO).build())
            .setBufferSizeInBytes(maxOf(min, rate / 5 * 4))
            .setTransferMode(android.media.AudioTrack.MODE_STREAM)
            .build().also { it.play() }
    }.getOrNull()

    fun push(samples: FloatArray?) {
        if (samples == null || samples.isEmpty()) return
        track?.write(samples, 0, samples.size, android.media.AudioTrack.WRITE_NON_BLOCKING)
    }

    fun release() { runCatching { track?.stop(); track?.release() } }
}
