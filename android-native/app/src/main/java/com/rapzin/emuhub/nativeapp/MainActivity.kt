package com.rapzin.emuhub.nativeapp

import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
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

@Composable
private fun EmuHubApp() {
    var page by remember { mutableStateOf("Início") }
    var selectedConsole by remember { mutableIntStateOf(NativeEmulator.NES) }
    var loadedName by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf(if (NativeEmulator.available) "Núcleo C++ carregado · ABI ${NativeEmulator.nativeAbi()}" else "Núcleo nativo indisponível neste build") }
    val context = LocalContext.current
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
                    val code = withContext(Dispatchers.Default) { NativeEmulator.load(selectedConsole, bytes) }
                    if (code == 0) {
                        loadedName = uri.lastPathSegment?.substringAfterLast('/') ?: "ROM carregada"
                        status = "ROM carregada no núcleo C++ · ${bytes.size / 1024} KB"
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
                "Início" -> HomeScreen(Modifier.padding(padding), status, loadedName, onBrowse = { page = "Biblioteca" })
                "Biblioteca" -> LibraryScreen(
                    Modifier.padding(padding), consoles, selectedConsole,
                    onSelect = { selectedConsole = it },
                    onImport = { picker.launch(arrayOf("*/*")) },
                    loadedName = loadedName, status = status,
                    onRun = {
                        val result = NativeEmulator.nativeRunFrame()
                        status = if (result == 0) "Um frame executado pelo núcleo C++" else "Não foi possível executar o frame ($result)"
                    }
                )
                "Sistemas" -> SystemsScreen(Modifier.padding(padding), consoles) { selectedConsole = it; page = "Biblioteca" }
                else -> SettingsScreen(Modifier.padding(padding), status)
            }
        }
    }
}

@Composable
private fun HomeScreen(modifier: Modifier = Modifier, status: String, loadedName: String?, onBrowse: () -> Unit) {
    LazyColumn(
        modifier.fillMaxSize().padding(horizontal = 20.dp),
        contentPadding = PaddingValues(top = 24.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp)
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("EMU HUB", color = Purple, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                    Text("Sua biblioteca.", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
                    Text("Seus clássicos em um só lugar.", color = Muted, fontSize = 13.sp)
                }
                Surface(color = Panel, shape = RoundedCornerShape(16.dp)) {
                    Icon(Icons.Rounded.SportsEsports, null, Modifier.padding(12.dp), tint = Purple)
                }
            }
        }
        item {
            Box(
                Modifier.fillMaxWidth().height(190.dp)
                    .background(Brush.linearGradient(listOf(Color(0xFF35245F), Color(0xFF171C31), Color(0xFF10141D))), RoundedCornerShape(26.dp))
                    .padding(20.dp)
            ) {
                Column(Modifier.align(Alignment.BottomStart)) {
                    Text("RETRO GAMING", color = Color(0xFFC9B7FF), fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                    Text(loadedName ?: "Continue sua jornada", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = onBrowse, colors = ButtonDefaults.buttonColors(containerColor = Purple)) {
                        Text(if (loadedName == null) "Importar primeiro jogo" else "Abrir biblioteca")
                        Icon(Icons.Rounded.ArrowForward, null, Modifier.padding(start = 8.dp))
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
    modifier: Modifier = Modifier, consoles: List<ConsoleItem>, selected: Int,
    onSelect: (Int) -> Unit, onImport: () -> Unit, loadedName: String?, status: String, onRun: () -> Unit
) {
    Column(modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Biblioteca", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
        Text("Escolha o sistema e importe uma ROM compatível.", color = Muted)
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
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = onRun, colors = ButtonDefaults.buttonColors(containerColor = Purple)) { Text("Executar 1 frame") }
                        OutlinedButton(onClick = { NativeEmulator.nativeReset() }) { Text("Reiniciar") }
                    }
                }
            }
        } else {
            Text(status, color = Muted, fontSize = 12.sp)
        }
        Text("A execução contínua, tela de jogo, áudio e controles virtuais ainda serão integrados.", color = Muted, fontSize = 11.sp)
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
