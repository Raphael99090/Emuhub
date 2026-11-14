package com.rapzin.emuhub.nativeapp

/**
 * JNI boundary for the existing C++17 NES / Game Boy / SNES core.
 * Console IDs follow hub/native/include/emuhub_core.h.
 */
object NativeEmulator {
    const val NES = 0
    const val GAME_BOY = 1
    const val SNES = 2

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

    fun select(console: Int): Boolean = available && nativeSelectConsole(console) == 0
    fun load(console: Int, bytes: ByteArray): Int {
        if (!available || !select(console)) return -100
        return nativeLoadRom(bytes)
    }
}
