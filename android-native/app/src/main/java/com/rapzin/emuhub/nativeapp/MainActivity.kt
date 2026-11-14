package com.rapzin.emuhub.nativeapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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

@Composable
private fun EmuHubApp() {
    var page by remember { mutableStateOf("Início") }
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
                "Início" -> HomeScreen(Modifier.padding(padding), onBrowse = { page = "Biblioteca" })
                "Biblioteca" -> LibraryScreen(Modifier.padding(padding))
                "Sistemas" -> SystemsScreen(Modifier.padding(padding))
                else -> SettingsScreen(Modifier.padding(padding))
            }
        }
    }
}

@Composable
private fun HomeScreen(modifier: Modifier = Modifier, onBrowse: () -> Unit) {
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
                    Icon(Icons.Rounded.Person, null, Modifier.padding(12.dp), tint = Purple)
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
                    Text("Continue de onde parou", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = onBrowse, colors = ButtonDefaults.buttonColors(containerColor = Purple)) {
                        Text("Abrir biblioteca")
                        Icon(Icons.Rounded.ArrowForward, null, Modifier.padding(start = 8.dp))
                    }
                }
            }
        }
        item { SectionTitle("Seus sistemas") }
        items(listOf("Nintendo · NES", "Super Nintendo · SNES", "Game Boy Advance · GBA", "Neo Geo")) { system ->
            SystemRow(system)
        }
        item {
            Text("Ainda não há jogos importados.", color = Muted, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
private fun LibraryScreen(modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize().padding(20.dp)) {
        Text("Biblioteca", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
        Text("Seus jogos organizados em um só lugar.", color = Muted)
        Spacer(Modifier.height(20.dp))
        Surface(color = Panel, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Search, null, tint = Muted)
                Text("Buscar jogos", color = Muted, modifier = Modifier.padding(start = 12.dp))
            }
        }
        Spacer(Modifier.height(22.dp))
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Rounded.SportsEsports, null, tint = Purple, modifier = Modifier.size(48.dp))
                Spacer(Modifier.height(12.dp))
                Text("Sua biblioteca está vazia", fontWeight = FontWeight.Bold)
                Text("A importação de ROMs será conectada na próxima etapa.", color = Muted, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun SystemsScreen(modifier: Modifier = Modifier) {
    LazyColumn(modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("Sistemas", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold) }
        item { Text("Núcleos disponíveis no projeto", color = Muted) }
        items(listOf("NES" to "Nintendo Entertainment System", "SNES" to "Super Nintendo", "GB / GBC" to "Game Boy", "GBA" to "Game Boy Advance", "SMS / GG" to "Master System / Game Gear", "Neo Geo" to "SNK Neo Geo")) { (short, full) ->
            SystemRow("$short  ·  $full")
        }
    }
}

@Composable
private fun SettingsScreen(modifier: Modifier = Modifier) {
    var vibration by remember { mutableStateOf(true) }
    var sound by remember { mutableStateOf(true) }
    Column(modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Configurações", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
        Text("Preferências do aplicativo", color = Muted)
        SettingSwitch("Vibração nos controles", vibration) { vibration = it }
        SettingSwitch("Efeitos sonoros", sound) { sound = it }
        Surface(color = Panel, shape = RoundedCornerShape(16.dp)) {
            Column(Modifier.padding(16.dp)) {
                Text("EmuHub Android nativo", fontWeight = FontWeight.Bold)
                Text("Prévia inicial · Kotlin + Jetpack Compose", color = Muted, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun SectionTitle(title: String) {
    Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold)
}

@Composable
private fun SystemRow(title: String) {
    Surface(color = Panel, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(color = Purple.copy(alpha = .14f), shape = RoundedCornerShape(12.dp)) {
                Icon(Icons.Rounded.Memory, null, Modifier.padding(11.dp), tint = Purple)
            }
            Text(title, Modifier.weight(1f).padding(start = 12.dp), fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            Icon(Icons.Rounded.ChevronRight, null, tint = Muted)
        }
    }
}

@Composable
private fun SettingSwitch(title: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Surface(color = Panel, shape = RoundedCornerShape(16.dp)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title, Modifier.weight(1f), fontSize = 14.sp)
            Switch(checked = checked, onCheckedChange = onChange)
        }
    }
}
