// SPDX-License-Identifier: GPL-3.0-or-later
//
// Tela de biblioteca do Emu Hub. A organização (modo de visualização salvo por orientação,
// filtros de recentes, busca e carrossel de cards sobrepostos) segue a ideia da tela de jogos
// do Eden (GamesFragment / CarouselRecyclerView). Código escrito em Jetpack Compose.
package com.rapzin.emuhub.nativeapp

import android.content.Context
import android.content.res.Configuration
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs

private val GInk = Color(0xFF090B12)
private val GPanel = Color(0xFF141925)
private val GPurple = Color(0xFF9A78FF)
private val GMuted = Color(0xFF929BAD)
private val GOutline = Color(0xFF3A4156)

internal enum class ViewMode(val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector) {
    GRID("Grade", Icons.Rounded.GridView),
    LIST("Lista", Icons.Rounded.ViewList),
    CAROUSEL("Carrossel", Icons.Rounded.ViewCarousel)
}

internal enum class SortFilter(val label: String) {
    ALPHABETICAL("Ordem alfabética"),
    RECENT_PLAYED("Jogados recentemente"),
    RECENT_ADDED("Adicionados recentemente"),
    FAVORITES("Favoritos")
}

/** Salva a biblioteca (mesmo formato do JSON usado na importação). */
internal fun saveLibrary(context: Context, games: List<GameEntry>) {
    val json = JSONArray()
    games.forEach {
        json.put(JSONObject().put("title", it.title).put("console", it.console).put("path", it.path).put("added", it.added).put("played", it.played).put("fav", it.favorite))
    }
    context.getSharedPreferences("emuhub_library", 0).edit().putString("games", json.toString()).apply()
}

private fun systemLabel(console: Int) = NativeEmulator.label(console)

private fun artwork(console: Int): List<Color> = when (console) {
    NativeEmulator.NES -> listOf(Color(0xFFB64D3D), Color(0xFF321C35), Color(0xFF111827))
    NativeEmulator.GAME_BOY -> listOf(Color(0xFF739B67), Color(0xFF263D39), Color(0xFF111827))
    else -> listOf(Color(0xFF526CCB), Color(0xFF32244F), Color(0xFF111827))
}

/** Pontua o quanto o título parece com a busca (0 = não combina). Aceita substring e letras na ordem. */
private fun searchScore(title: String, query: String): Int {
    if (query.isBlank()) return 1
    val t = title.lowercase(); val q = query.trim().lowercase()
    if (t.startsWith(q)) return 300
    if (t.contains(q)) return 200
    var i = 0
    for (c in t) { if (i < q.length && c == q[i]) i++ }
    return if (i == q.length) 100 else 0
}

/** Aplica busca e filtro. */
internal fun filterGames(games: List<GameEntry>, query: String, filter: SortFilter): List<GameEntry> {
    val base = when (filter) {
        SortFilter.ALPHABETICAL -> games.sortedBy { it.title.lowercase() }
        SortFilter.RECENT_PLAYED -> games.filter { it.played > 0 }.sortedByDescending { it.played }
        SortFilter.RECENT_ADDED -> games.filter { it.added > 0 }.sortedByDescending { it.added }
        SortFilter.FAVORITES -> games.filter { it.favorite }.sortedBy { it.title.lowercase() }
    }
    if (query.isBlank()) return base
    return base.map { it to searchScore(it.title, query) }.filter { it.second > 0 }.sortedByDescending { it.second }.map { it.first }
}

/** Botão redondo de 42dp com contorno, como os do topo da tela de jogos do Eden. */
@Composable
private fun RoundAction(icon: androidx.compose.ui.graphics.vector.ImageVector, description: String, active: Boolean = false, onClick: () -> Unit) {
    Box(
        Modifier.size(42.dp).clip(CircleShape).border(BorderStroke(1.dp, if (active) GPurple else GOutline), CircleShape).clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) { Icon(icon, description, tint = if (active) GPurple else GMuted, modifier = Modifier.size(18.dp)) }
}

@Composable
private fun GameArt(game: GameEntry, modifier: Modifier = Modifier, titleSize: Int = 15, actions: GameActions? = null) {
    Box(modifier.background(Brush.linearGradient(artwork(game.console)), RoundedCornerShape(18.dp)).padding(12.dp)) {
        Surface(color = Color.Black.copy(alpha = .28f), shape = RoundedCornerShape(8.dp), modifier = Modifier.align(Alignment.TopStart)) {
            Text(systemLabel(game.console), Modifier.padding(horizontal = 8.dp, vertical = 5.dp), color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.Bold)
        }
        if (actions != null) GameMenu(game, actions, Modifier.align(Alignment.TopEnd))
        Text(game.title.take(2).uppercase(), Modifier.align(Alignment.Center), color = Color.White.copy(alpha = .26f), fontSize = 56.sp, fontWeight = FontWeight.Black)
        Text(game.title, Modifier.align(Alignment.BottomStart), color = Color.White, fontSize = titleSize.sp, fontWeight = FontWeight.ExtraBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

internal class GameActions(val onFavorite: (GameEntry) -> Unit, val onRemove: (GameEntry) -> Unit)

/** Botão "⋮" de cada jogo: favoritar e remover da biblioteca. */
@Composable
private fun GameMenu(game: GameEntry, actions: GameActions, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        Icon(if (game.favorite) Icons.Rounded.Star else Icons.Rounded.MoreVert, "Opções", tint = if (game.favorite) Color(0xFFFFD166) else Color.White.copy(alpha = .8f),
            modifier = Modifier.size(26.dp).clip(CircleShape).clickable { open = true }.padding(2.dp))
        DropdownMenu(open, { open = false }) {
            DropdownMenuItem(
                text = { Text(if (game.favorite) "Tirar dos favoritos" else "Favoritar") },
                leadingIcon = { Icon(Icons.Rounded.Star, null) },
                onClick = { open = false; actions.onFavorite(game) }
            )
            DropdownMenuItem(
                text = { Text("Remover da biblioteca") },
                leadingIcon = { Icon(Icons.Rounded.Delete, null) },
                onClick = { open = false; actions.onRemove(game) }
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun GameCarousel(games: List<GameEntry>, onPlay: (GameEntry) -> Unit, actions: GameActions, modifier: Modifier = Modifier) {
    val pager = rememberPagerState(pageCount = { games.size })
    val cardWidth = 190.dp
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val sidePad = ((maxWidth - cardWidth) / 2).coerceAtLeast(0.dp)
        HorizontalPager(
            state = pager,
            contentPadding = PaddingValues(horizontal = sidePad),
            pageSize = androidx.compose.foundation.pager.PageSize.Fixed(cardWidth),
            pageSpacing = (-34).dp,                      // cards se sobrepõem
            verticalAlignment = Alignment.CenterVertically,
            key = { games[it].path },
            modifier = Modifier.fillMaxSize()
        ) { page ->
            val offset = abs((pager.currentPage - page) + pager.currentPageOffsetFraction)
            val dist = offset.coerceIn(0f, 2f)
            val scale by animateFloatAsState(1f - 0.18f * dist.coerceAtMost(1f) - 0.06f * (dist - 1f).coerceAtLeast(0f), label = "scale")
            val alpha by animateFloatAsState((1f - 0.45f * dist.coerceAtMost(1f)).coerceAtLeast(0.2f), label = "alpha")
            GameArt(
                games[page],
                Modifier.zIndex(10f - dist * 5f).width(cardWidth).fillMaxHeight(0.9f)
                    .graphicsLayer { scaleX = scale; scaleY = scale; this.alpha = alpha }
                    .clickable { onPlay(games[page]) },
                titleSize = 17, actions = actions
            )
        }
    }
}

@Composable
private fun GameGrid(games: List<GameEntry>, onPlay: (GameEntry) -> Unit, actions: GameActions, modifier: Modifier = Modifier) {
    LazyVerticalGrid(
        columns = GridCells.Adaptive(150.dp), modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        items(games, key = { it.path }) { g -> GameArt(g, Modifier.fillMaxWidth().aspectRatio(0.8f).clickable { onPlay(g) }, actions = actions) }
    }
}

@Composable
private fun GameList(games: List<GameEntry>, onPlay: (GameEntry) -> Unit, actions: GameActions, modifier: Modifier = Modifier) {
    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(games, key = { it.path }) { g ->
            Row(
                Modifier.fillMaxWidth().background(GPanel, RoundedCornerShape(16.dp)).clickable { onPlay(g) }.padding(10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(Modifier.size(52.dp).background(Brush.linearGradient(artwork(g.console)), RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                    Text(g.title.take(2).uppercase(), color = Color.White.copy(alpha = .5f), fontWeight = FontWeight.Black)
                }
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(g.title, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(systemLabel(g.console), color = GMuted, fontSize = 11.sp)
                }
                GameMenu(g, actions)
                Icon(Icons.Rounded.PlayArrow, null, tint = GPurple)
            }
        }
    }
}

/**
 * Biblioteca no estilo do Eden: título, botões redondos de visualização e filtro, busca,
 * escolha do sistema para importar e a lista de jogos em grade, lista ou carrossel.
 */
@Composable
internal fun GamesScreen(
    modifier: Modifier,
    games: List<GameEntry>,
    systems: List<Pair<Int, String>>,
    selectedSystem: Int,
    onSelectSystem: (Int) -> Unit,
    onImport: () -> Unit,
    onImportFolder: () -> Unit,
    onPlay: (GameEntry) -> Unit,
    actions: GameActions,
    status: String
) {
    val context = LocalContext.current
    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
    val prefs = remember { context.getSharedPreferences("emuhub_ui", 0) }
    val modeKey = if (landscape) "games_view_landscape" else "games_view_portrait"
    var mode by remember(modeKey) { mutableStateOf(runCatching { ViewMode.valueOf(prefs.getString(modeKey, null) ?: "") }.getOrDefault(if (landscape) ViewMode.CAROUSEL else ViewMode.GRID)) }
    var filter by remember { mutableStateOf(runCatching { SortFilter.valueOf(prefs.getString("games_filter", null) ?: "") }.getOrDefault(SortFilter.ALPHABETICAL)) }
    var query by remember { mutableStateOf("") }
    var viewMenu by remember { mutableStateOf(false) }
    var filterMenu by remember { mutableStateOf(false) }
    val shown = remember(games.toList(), query, filter) { filterGames(games, query, filter) }

    Column(modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("EMU HUB", Modifier.weight(1f), color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace, letterSpacing = 2.sp)
            Box {
                RoundAction(mode.icon, "Modo de visualização", active = viewMenu) { viewMenu = true }
                DropdownMenu(viewMenu, { viewMenu = false }) {
                    ViewMode.values().forEach { m ->
                        DropdownMenuItem(
                            text = { Text(m.label) }, leadingIcon = { Icon(m.icon, null) },
                            trailingIcon = { if (m == mode) Icon(Icons.Rounded.Check, null, tint = GPurple) },
                            onClick = { mode = m; prefs.edit().putString(modeKey, m.name).apply(); viewMenu = false }
                        )
                    }
                }
            }
            Spacer(Modifier.width(12.dp))
            Box {
                RoundAction(Icons.Rounded.FilterList, "Filtro", active = filterMenu) { filterMenu = true }
                DropdownMenu(filterMenu, { filterMenu = false }) {
                    SortFilter.values().forEach { f ->
                        DropdownMenuItem(
                            text = { Text(f.label) },
                            trailingIcon = { if (f == filter) Icon(Icons.Rounded.Check, null, tint = GPurple) },
                            onClick = { filter = f; prefs.edit().putString("games_filter", f.name).apply(); filterMenu = false }
                        )
                    }
                }
            }
            Spacer(Modifier.width(12.dp))
            RoundAction(Icons.Rounded.FolderOpen, "Escolher pasta de ROMs", onClick = onImportFolder)
            Spacer(Modifier.width(12.dp))
            RoundAction(Icons.Rounded.Add, "Adicionar jogo", onClick = onImport)
        }

        OutlinedTextField(
            value = query, onValueChange = { query = it }, singleLine = true,
            placeholder = { Text("Buscar jogos", color = GMuted) },
            leadingIcon = { Icon(Icons.Rounded.Search, null, tint = GMuted) },
            trailingIcon = { if (query.isNotEmpty()) IconButton({ query = "" }) { Icon(Icons.Rounded.Close, "Limpar", tint = GMuted) } },
            shape = RoundedCornerShape(24.dp),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = GPurple, unfocusedBorderColor = GOutline, cursorColor = GPurple),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp)
        )

        // Sistema usado ao importar a próxima ROM
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Importar como", color = GMuted, fontSize = 11.sp)
            systems.forEach { (id, label) ->
                FilterChip(
                    selected = selectedSystem == id, onClick = { onSelectSystem(id) }, label = { Text(label, fontSize = 11.sp) },
                    colors = FilterChipDefaults.filterChipColors(selectedContainerColor = GPurple.copy(alpha = .22f), selectedLabelColor = GPurple)
                )
            }
        }
        Spacer(Modifier.height(10.dp))

        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                games.isEmpty() -> EmptyState("Sua biblioteca está vazia", "Toque em + para importar uma ROM ou na pasta para escanear uma pasta inteira.", Icons.Rounded.AddToPhotos, onImport)
                shown.isEmpty() -> EmptyState(
                    if (query.isNotBlank()) "Nenhum jogo encontrado" else "Nada por aqui ainda",
                    if (query.isNotBlank()) "Tente outro nome." else "Nada neste filtro ainda.",
                    Icons.Rounded.SearchOff, null
                )
                mode == ViewMode.GRID -> GameGrid(shown, onPlay, actions)
                mode == ViewMode.LIST -> GameList(shown, onPlay, actions)
                else -> GameCarousel(shown, onPlay, actions, Modifier.fillMaxSize())
            }
        }
        if (status.isNotBlank()) Text(status, Modifier.padding(horizontal = 20.dp, vertical = 8.dp), color = GMuted, fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun EmptyState(title: String, text: String, icon: androidx.compose.ui.graphics.vector.ImageVector, action: (() -> Unit)?) {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Icon(icon, null, tint = GPurple, modifier = Modifier.size(42.dp))
        Text(title, Modifier.padding(top = 12.dp), fontWeight = FontWeight.Bold)
        Text(text, color = GMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
        if (action != null) Button(onClick = action, Modifier.padding(top = 14.dp), colors = ButtonDefaults.buttonColors(containerColor = GPurple)) { Text("Importar jogo") }
    }
}
