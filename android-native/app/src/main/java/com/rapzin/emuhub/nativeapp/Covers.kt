// SPDX-License-Identifier: GPL-3.0-or-later
package com.rapzin.emuhub.nativeapp

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Capas: caixa baixada do libretro (se achar pelo nome) ou, se não, uma captura da tela do próprio jogo. */
internal object Covers {
    private val gate = Semaphore(3)

    fun key(console: Int, title: String) = "${console}_" + title.replace(Regex("[^A-Za-z0-9._-]"), "_")
    private fun dir(c: Context) = File(c.filesDir, "covers").apply { mkdirs() }
    fun shotFile(c: Context, console: Int, title: String) = File(dir(c), key(console, title) + ".shot.png")
    private fun boxFile(c: Context, console: Int, title: String) = File(dir(c), key(console, title) + ".png")
    private fun missFile(c: Context, console: Int, title: String) = File(dir(c), key(console, title) + ".none")

    private fun systems(console: Int): List<String> = when (console) {
        NativeEmulator.NES -> listOf("Nintendo - Nintendo Entertainment System")
        NativeEmulator.GAME_BOY -> listOf("Nintendo - Game Boy", "Nintendo - Game Boy Color")
        NativeEmulator.SNES -> listOf("Nintendo - Super Nintendo Entertainment System")
        NativeEmulator.MASTER_SYSTEM -> listOf("Sega - Master System - Mark III")
        NativeEmulator.GAME_GEAR -> listOf("Sega - Game Gear")
        NativeEmulator.GBA -> listOf("Nintendo - Game Boy Advance")
        else -> emptyList()
    }

    private fun cleanName(title: String): String {
        val noExt = title.replace(Regex("\\.(nes|gb|gbc|sfc|smc|sms|gg|gba|neo|zip)$", RegexOption.IGNORE_CASE), "")
        return noExt.replace(Regex("[&*/:`<>?\\\\|\"]"), "_")
    }

    private fun decode(f: File): Bitmap? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.path, bounds)
        val opts = BitmapFactory.Options().apply { inSampleSize = maxOf(1, bounds.outWidth / 480) }
        BitmapFactory.decodeFile(f.path, opts)
    }.getOrNull()

    private fun download(c: Context, console: Int, title: String): File? {
        val out = boxFile(c, console, title)
        val name = URLEncoder.encode(cleanName(title), "UTF-8").replace("+", "%20")
        for (sys in systems(console)) {
            val url = "https://thumbnails.libretro.com/" + URLEncoder.encode(sys, "UTF-8").replace("+", "%20") + "/Named_Boxarts/$name.png"
            val ok = runCatching {
                val con = URL(url).openConnection() as HttpURLConnection
                con.connectTimeout = 8000; con.readTimeout = 8000
                if (con.responseCode != 200) { con.disconnect(); return@runCatching false }
                val tmp = File(out.path + ".tmp")
                con.inputStream.use { i -> tmp.outputStream().use { o -> i.copyTo(o) } }
                con.disconnect()
                tmp.renameTo(out)
            }.getOrDefault(false)
            if (ok) return out
        }
        return null
    }

    suspend fun load(c: Context, game: GameEntry): Bitmap? = withContext(Dispatchers.IO) {
        val box = boxFile(c, game.console, game.title)
        if (box.isFile) return@withContext decode(box)
        val miss = missFile(c, game.console, game.title)
        val recentlyMissed = miss.isFile && System.currentTimeMillis() - miss.lastModified() < 3L * 24 * 3600 * 1000
        if (!recentlyMissed && systems(game.console).isNotEmpty()) {
            val got = gate.withPermit { download(c, game.console, game.title) }
            if (got != null) return@withContext decode(got)
            runCatching { miss.writeText("x") }
        }
        val shot = shotFile(c, game.console, game.title)
        if (shot.isFile) decode(shot) else null
    }

    fun saveShot(c: Context, console: Int, title: String, bmp: Bitmap) {
        runCatching { shotFile(c, console, title).outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 90, it) } }
    }
}
