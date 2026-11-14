package com.rapzin.emuhub.nativeapp

import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
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
}

private data class ConsoleItem(val id: Int, val short: String, val full: String, val native: Boolean)
private data class GameEntry(val title: String, val console: Int, val path: String)

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
                val game = GameEntry(item.getString("title"), item.getInt("console"), item.getString("path"))
                if (File(game.path).exists()) games.add(game)
            }
        }
    }
    var status by remember { mutableStateOf(if (NativeEmulator.available) "Núcleo C++ carregado · ABI ${NativeEmulator.nativeAbi()}" else "Núcleo nativo indisponível neste build") }
    val scope = rememberCoroutineScope()
    val consoles = remember {
        listOf(
            ConsoleItem(NativeEmulator.NES, "NES", "Nintendo Entertainment System", true),
            ConsoleItem(NativeEmulator.GAME_BOY, "GB / GBC", "Game Boy / Game Boy Color", true),
            ConsoleItem(NativeEmulator.SNES, "SNES", "Super Nintendo", true),
            ConsoleItem(3, "GBA", "Game Boy Advance", false),
            ConsoleItem(4, "SMS / GG", "Master System / Game Gear", false),
            ConsoleItem(5, "Neo Geo", "SNK Neo Geo", false)
        )
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) {
            scope.launch {
                status = "Lendo ROM..."
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
                    if (code == 0) {
                        loadedName = uri.lastPathSegment?.substringAfterLast('/') ?: "ROM carregada"
                        games.removeAll { it.title == loadedName && it.console == selectedConsole }
                        games.add(GameEntry(loadedName!!, selectedConsole, imported))
                        val json = JSONArray()
                        games.forEach { game -> json.put(JSONObject().put("title", game.title).put("console", game.console).put("path", game.path)) }
                        context.getSharedPreferences("emuhub_library", 0).edit().putString("games", json.toString()).apply()
                        status = "ROM salva na biblioteca · ${bytes.size / 1024} KB"
                    } else {
                        status = "O núcleo recusou a ROM (código $code). Confira o formato e o sistema selecionado."
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
                "Início" -> HomeScreen(Modifier.padding(padding), status, games, onBrowse = { page = "Biblioteca" }, onPlay = { game ->
                    val romBytes = runCatching { File(game.path).readBytes() }.getOrNull()
                    val code = if (romBytes != null) NativeEmulator.load(game.console, romBytes) else -101
                    if (code == 0) { selectedConsole = game.console; loadedName = game.title; page = "Jogar" }
                    else status = "Falha ao abrir ${game.title} (código $code)"
                })
                "Biblioteca" -> LibraryScreen(
                    Modifier.padding(padding), consoles, selectedConsole, games,
                    onSelect = { selectedConsole = it },
                    onImport = { picker.launch(arrayOf("*/*")) },
                    onPlay = { game ->
                        val romBytes = runCatching { File(game.path).readBytes() }.getOrNull()
                        val code = if (romBytes != null) NativeEmulator.load(game.console, romBytes) else -101
                        if (code == 0) { selectedConsole = game.console; loadedName = game.title; page = "Jogar" }
                        else status = "Falha ao abrir ${game.title} (código $code)"
                    },
                    loadedName = loadedName, status = status,
                    onRun = { page = "Jogar" }
                )
                "Jogar" -> GameScreen(
                    Modifier.padding(padding), loadedName ?: "Jogo", selectedConsole,
                    onBack = { page = "Biblioteca" },
                    onReset = { NativeEmulator.nativeReset() }
                )
                "Sistemas" -> SystemsScreen(Modifier.padding(padding), consoles) { selectedConsole = it; page = "Biblioteca" }
                else -> SettingsScreen(Modifier.padding(padding), status)
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
                                    Text(listOf("NES", "GB / GBC", "SNES").getOrElse(game.console) { "RETRO" }, modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp), color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.Bold)
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

@Composable
private fun LibraryScreen(
    modifier: Modifier = Modifier, consoles: List<ConsoleItem>, selected: Int, games: List<GameEntry>,
    onSelect: (Int) -> Unit, onImport: () -> Unit, onPlay: (GameEntry) -> Unit,
    loadedName: String?, status: String, onRun: () -> Unit
) {
    LazyColumn(modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { Text("Biblioteca", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold) }
        item { Text("Sua coleção de jogos", color = Muted) }
        if (games.isNotEmpty()) {
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(games, key = { "library-${it.console}-${it.title}" }) { game ->
                        Column(Modifier.width(142.dp).clickable { onPlay(game) }) {
                            Box(Modifier.fillMaxWidth().height(176.dp).background(
                                Brush.linearGradient(listOf(Color(0xFF49347B), Color(0xFF171C31), Color(0xFF10141D))),
                                RoundedCornerShape(16.dp)
                            ), contentAlignment = Alignment.Center) {
                                Text(game.title.take(2).uppercase(), color = Color.White.copy(alpha = .35f), fontSize = 48.sp, fontWeight = FontWeight.Black)
                                Icon(Icons.Rounded.PlayCircle, null, tint = Color.White, modifier = Modifier.align(Alignment.BottomEnd).padding(10.dp))
                            }
                            Text(game.title, maxLines = 1, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 7.dp))
                            Text(listOf("NES", "GB / GBC", "SNES").getOrElse(game.console) { "Sistema" }, color = Muted, fontSize = 10.sp)
                        }
                    }
                }
            }
        }
        consoles.filter { it.native }.forEach { item ->
            Row(
                Modifier.fillMaxWidth().background(if (selected == item.id) Purple.copy(alpha = .14f) else Panel, RoundedCornerShape(14.dp))
                    .clickable { onSelect(item.id) }.padding(14.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Rounded.Memory, null, tint = Purple)
                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                    Text(item.short, fontWeight = FontWeight.Bold)
                    Text(item.full, color = Muted, fontSize = 11.sp)
                }
                if (selected == item.id) Icon(Icons.Rounded.CheckCircle, null, tint = Purple)
            }
        }
        Button(onClick = onImport, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Purple)) {
            Icon(Icons.Rounded.FolderOpen, null)
            Text("Selecionar ROM", Modifier.padding(start = 8.dp))
        }
        if (loadedName != null) {
            Surface(color = Panel, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(loadedName, fontWeight = FontWeight.Bold)
                    Text(status, color = Muted, fontSize = 12.sp)
                    Button(onClick = onRun, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Purple)) {
                        Icon(Icons.Rounded.PlayArrow, null)
                        Text("Jogar", Modifier.padding(start = 8.dp))
                    }
                    OutlinedButton(onClick = { NativeEmulator.nativeReset() }, modifier = Modifier.fillMaxWidth()) { Text("Reiniciar") }
                }
            }
        } else {
            Text(status, color = Muted, fontSize = 12.sp)
        }
    }
}

@Composable
private fun GameScreen(modifier: Modifier, gameName: String, console: Int, onBack: () -> Unit, onReset: () -> Unit) {
    var frameBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var running by remember { mutableStateOf(true) }
    var frameError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(running, console) {
        if (running && NativeEmulator.available) {
            while (isActive) {
                val rendered = withContext(Dispatchers.Default) {
                    val result = NativeEmulator.nativeRunFrame()
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
                delay(16)
            }
        }
    }

    Column(modifier.fillMaxSize().padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { running = false; onBack() }) { Icon(Icons.Rounded.ArrowBack, "Voltar") }
            Column(Modifier.weight(1f)) {
                Text(gameName, fontWeight = FontWeight.Bold, maxLines = 1)
                Text(listOf("NES", "GB / GBC", "SNES").getOrElse(console) { "Emulador" }, color = Muted, fontSize = 11.sp)
            }
            IconButton(onClick = onReset) { Icon(Icons.Rounded.Refresh, "Reiniciar") }
            IconButton(onClick = { running = !running }) { Icon(if (running) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, "Pausar") }
        }
        Box(
            Modifier.fillMaxWidth().weight(1f).background(Color.Black, RoundedCornerShape(14.dp)),
            contentAlignment = Alignment.Center
        ) {
            val bitmap = frameBitmap
            if (bitmap != null) {
                Image(bitmap.asImageBitmap(), contentDescription = "Tela do jogo", modifier = Modifier.fillMaxWidth(), contentScale = ContentScale.Fit)
            } else {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = Purple)
                    Text(frameError ?: "Iniciando jogo...", color = Muted, modifier = Modifier.padding(top = 12.dp))
                }
            }
        }
        GameControls(console)
        Text("Controles virtuais · toque para pressionar", color = Muted, fontSize = 10.sp)
    }
}

@Composable
private fun GameControls(console: Int) {
    var pressed by remember { mutableIntStateOf(0) }
    fun update(bit: Int, down: Boolean) {
        pressed = if (down) pressed or bit else pressed and bit.inv()
        NativeEmulator.nativeButtons(pressed)
    }
    @Composable
    fun PadButton(label: String, bit: Int, modifier: Modifier = Modifier) {
        Box(
            modifier.size(54.dp).background(Panel, CircleShape).pointerInteropFilter { event ->
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> update(bit, true)
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
            PadButton("B", if (console == NativeEmulator.SNES) 2 else 2)
            PadButton("A", if (console == NativeEmulator.SNES) 1 else 1)
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
private fun SettingsScreen(modifier: Modifier = Modifier, status: String) {
    Column(modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Configurações", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
        Text("Estado e informações do motor", color = Muted)
        Surface(color = Panel, shape = RoundedCornerShape(16.dp)) {
            Column(Modifier.padding(16.dp)) {
                Text("Núcleo C++", fontWeight = FontWeight.Bold)
                Text(status, color = Muted, fontSize = 12.sp)
                Text("NES, Game Boy e SNES disponíveis na ABI atual.", color = Muted, fontSize = 12.sp)
            }
        }
        Surface(color = Panel, shape = RoundedCornerShape(16.dp)) {
            Column(Modifier.padding(16.dp)) {
                Text("BIOS", fontWeight = FontWeight.Bold)
                Text("Os núcleos NES, GB e SNES atuais não expõem uma API de importação de BIOS nesta integração.", color = Muted, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun SectionTitle(title: String) {
    Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold)
}
