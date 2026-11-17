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
