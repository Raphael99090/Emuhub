package com.rapzin.emuhub.nativeapp

import java.io.ByteArrayInputStream
import java.io.File
import java.util.zip.ZipInputStream

/**
 * JNI boundary for the C++17 core (NES, Game Boy/GBC, SNES, Master System, Game Gear, GBA, Neo Geo).
 * Console IDs follow hub/native/include/emuhub_core.h.
 */
object NativeEmulator {
    const val NES = 0
    const val GAME_BOY = 1
    const val SNES = 2
    const val MASTER_SYSTEM = 3
    const val GAME_GEAR = 4
    const val GBA = 5
    const val NEO_GEO = 6

    /** Result of [load] for a Neo Geo BIOS archive: the BIOS was installed, there is no game to run yet. */
    const val BIOS_INSTALLED = 100
    /** Neo Geo game opened before any BIOS was installed. */
    const val NEO_NEEDS_BIOS = 2

    val available: Boolean = runCatching { System.loadLibrary("emuhub_jni") }.isSuccess

    external fun nativeAbi(): Int
    external fun nativeSelectConsole(console: Int): Int
    external fun nativeLoadRom(bytes: ByteArray): Int
    external fun nativeRunFrame(): Int
    external fun nativeWidth(): Int
    external fun nativeHeight(): Int
    external fun nativeFrame(): IntArray?
    external fun nativeButtons(mask: Int)
    external fun nativeReset()
    external fun nativeDestroy()
    external fun nativeNeoClearFiles()
    external fun nativeNeoAddFile(name: String, bytes: ByteArray)
    external fun nativeNeoSetBios(): Int
    external fun nativeNeoHasBios(): Int
    external fun nativeNeoLoadSet(): Int
    external fun nativeNeoError(): String

    /** Folder where the Neo Geo BIOS archive is kept between runs (set once from the app's files dir). */
    var neoBiosFile: File? = null

    fun label(console: Int): String = when (console) {
        NES -> "NES"
        GAME_BOY -> "GB / GBC"
        SNES -> "SNES"
        MASTER_SYSTEM -> "Master System"
        GAME_GEAR -> "Game Gear"
        GBA -> "GBA"
        NEO_GEO -> "Neo Geo"
        else -> "RETRO"
    }

    fun select(console: Int): Boolean = available && nativeSelectConsole(console) == 0

    fun load(console: Int, bytes: ByteArray): Int {
        if (!available || !select(console)) return -100
        return if (console == NEO_GEO) loadNeoGeo(bytes) else nativeLoadRom(bytes)
    }

    private fun isZip(b: ByteArray) = b.size > 4 && b[0] == 'P'.code.toByte() && b[1] == 'K'.code.toByte()

    private fun addZip(bytes: ByteArray) {
        nativeNeoClearFiles()
        ZipInputStream(ByteArrayInputStream(bytes)).use { zin ->
            while (true) {
                val e = zin.nextEntry ?: break
                if (!e.isDirectory) nativeNeoAddFile(e.name.substringAfterLast('/'), zin.readBytes())
            }
        }
    }

    private fun ensureNeoBios() {
        if (nativeNeoHasBios() == 1) return
        val f = neoBiosFile ?: return
        if (!f.isFile) return
        runCatching { addZip(f.readBytes()); nativeNeoSetBios() }
        nativeNeoClearFiles()
    }

    /** .neo file, MAME-style game zip, or the neogeo.zip BIOS archive (installed and remembered). */
    private fun loadNeoGeo(bytes: ByteArray): Int {
        ensureNeoBios()
        if (!isZip(bytes)) return nativeLoadRom(bytes)
        val entries = runCatching { addZip(bytes) }
        if (entries.isFailure) return -102
        if (nativeNeoSetBios() == 0) {
            neoBiosFile?.let { runCatching { it.parentFile?.mkdirs(); it.writeBytes(bytes) } }
            nativeNeoClearFiles()
            return BIOS_INSTALLED
        }
        return nativeNeoLoadSet()
    }
}
