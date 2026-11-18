// SPDX-License-Identifier: GPL-3.0-or-later
package com.rapzin.emuhub.nativeapp

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import java.io.File

/** Ajustes simples guardados em SharedPreferences. */
internal object AppSettings {
    private fun p(c: Context) = c.getSharedPreferences("emuhub_settings", 0)
    fun volume(c: Context) = p(c).getFloat("volume", 1f)
    fun setVolume(c: Context, v: Float) = p(c).edit().putFloat("volume", v).apply()
    fun haptics(c: Context) = p(c).getBoolean("haptics", true)
    fun setHaptics(c: Context, v: Boolean) = p(c).edit().putBoolean("haptics", v).apply()
    fun keepOn(c: Context) = p(c).getBoolean("keep_on", true)
    fun setKeepOn(c: Context, v: Boolean) = p(c).edit().putBoolean("keep_on", v).apply()
    fun smooth(c: Context) = p(c).getBoolean("smooth", false)
    fun setSmooth(c: Context, v: Boolean) = p(c).edit().putBoolean("smooth", v).apply()
    fun folders(c: Context): List<String> = p(c).getStringSet("folders", emptySet())!!.sorted()
    fun setFolders(c: Context, f: Collection<String>) = p(c).edit().putStringSet("folders", f.toSet()).apply()
}

internal data class FoundRom(val name: String, val uri: String, val console: Int)
internal data class ScanResult(val roms: List<FoundRom>, val biosUris: List<String>)

/** Descobre o sistema pela extensão do arquivo; null se não for uma ROM conhecida. */
internal fun detectConsole(fileName: String): Int? = when (fileName.substringAfterLast('.', "").lowercase()) {
    "nes" -> NativeEmulator.NES
    "gb", "gbc" -> NativeEmulator.GAME_BOY
    "sfc", "smc" -> NativeEmulator.SNES
    "sms" -> NativeEmulator.MASTER_SYSTEM
    "gg" -> NativeEmulator.GAME_GEAR
    "gba" -> NativeEmulator.GBA
    "neo", "zip" -> NativeEmulator.NEO_GEO
    else -> null
}

internal fun titleOf(fileName: String) = fileName.substringBeforeLast('.', fileName)

/** Percorre a pasta escolhida (e subpastas) procurando ROMs. O neogeo.zip vira BIOS. */
internal fun scanTree(context: Context, tree: Uri): ScanResult {
    val roms = ArrayList<FoundRom>()
    val bios = ArrayList<String>()
    val resolver = context.contentResolver
    fun walk(docId: String, depth: Int) {
        if (depth > 6) return
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
        val cols = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE)
        runCatching {
            resolver.query(children, cols, null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    val id = c.getString(0) ?: continue
                    val name = c.getString(1) ?: continue
                    if (c.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR) { walk(id, depth + 1); continue }
                    val uri = DocumentsContract.buildDocumentUriUsingTree(tree, id).toString()
                    if (name.equals("neogeo.zip", true)) { bios.add(uri); continue }
                    val console = detectConsole(name) ?: continue
                    if (name.endsWith(".zip", true) && !looksLikeNeoGeoZip(context, uri)) continue   // zip que não é Neo Geo (ex.: jogos de outros sistemas)
                    roms.add(FoundRom(titleOf(name), uri, console))
                }
            }
        }
    }
    walk(DocumentsContract.getTreeDocumentId(tree), 0)
    return ScanResult(roms, bios)
}

/** Lê uma ROM guardada como arquivo local ou como URI de documento. */
internal fun readRom(context: Context, path: String): ByteArray? = runCatching {
    if (path.startsWith("content://")) context.contentResolver.openInputStream(Uri.parse(path))?.use { it.readBytes() }
    else File(path).readBytes()
}.getOrNull()

internal fun folderLabel(uri: String): String =
    runCatching { Uri.parse(uri).let { DocumentsContract.getTreeDocumentId(it) }.substringAfter(':').ifBlank { "/" } }.getOrDefault(uri)

/** Lê só o diretório central do zip (sem descompactar) e confere se há arquivos de ROM de Neo Geo (.p1 .s1 .m1 .v1 .c1). */
internal fun looksLikeNeoGeoZip(context: Context, uriStr: String): Boolean = runCatching {
    context.contentResolver.openFileDescriptor(Uri.parse(uriStr), "r")?.use { pfd ->
        java.io.FileInputStream(pfd.fileDescriptor).channel.use { ch ->
            val size = ch.size()
            val tailLen = minOf(size, 70_000L).toInt()
            val tail = java.nio.ByteBuffer.allocate(tailLen).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            ch.position(size - tailLen); while (tail.hasRemaining()) if (ch.read(tail) < 0) break
            tail.flip()
            var eocd = -1
            for (i in tailLen - 22 downTo 0) if (tail.getInt(i) == 0x06054b50) { eocd = i; break }
            if (eocd < 0) return@use false
            val cdSize = tail.getInt(eocd + 12).toLong() and 0xFFFFFFFFL
            val cdOff = tail.getInt(eocd + 16).toLong() and 0xFFFFFFFFL
            if (cdSize <= 0 || cdSize > 4_000_000) return@use false
            val cd = java.nio.ByteBuffer.allocate(cdSize.toInt()).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            ch.position(cdOff); while (cd.hasRemaining()) if (ch.read(cd) < 0) break
            cd.flip()
            val re = Regex("\\.(p\\d|s1|m1|v\\d|c\\d)$", RegexOption.IGNORE_CASE)
            var hits = 0; var pos = 0
            while (pos + 46 <= cd.limit() && cd.getInt(pos) == 0x02014b50) {
                val n = cd.getShort(pos + 28).toInt() and 0xFFFF
                val m = cd.getShort(pos + 30).toInt() and 0xFFFF
                val k = cd.getShort(pos + 32).toInt() and 0xFFFF
                val nameBytes = ByteArray(n); for (j in 0 until n) nameBytes[j] = cd.get(pos + 46 + j)
                if (re.containsMatchIn(String(nameBytes))) hits++
                pos += 46 + n + m + k
            }
            hits >= 3
        }
    } ?: false
}.getOrDefault(false)
