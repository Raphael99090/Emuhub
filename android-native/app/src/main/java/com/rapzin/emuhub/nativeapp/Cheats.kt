// SPDX-License-Identifier: GPL-3.0-or-later
package com.rapzin.emuhub.nativeapp

import java.io.File

/** Códigos de trapaça: RAM "ENDEREÇO:VALOR" (hex) em qualquer sistema e Game Genie de 6/8 letras no NES. */
internal object Cheats {
    sealed class Op {
        data class Ram(val addr: Int, val value: Int) : Op()
        data class Gg(val addr: Int, val value: Int, val compare: Int) : Op()
    }

    private const val LETTERS = "APZLGITYEOXUKSVN"
    private val ramRe = Regex("^([0-9A-Fa-f]{4,6})\\s*[:=]\\s*([0-9A-Fa-f]{2})$")
    private val ggRe = Regex("^[APZLGITYEOXUKSVNapzlgityeoxuksvn]{6}$|^[APZLGITYEOXUKSVNapzlgityeoxuksvn]{8}$")

    /** Lança IllegalArgumentException com mensagem pronta para mostrar ao usuário. */
    fun parse(text: String, console: Int): List<Op> {
        val ops = ArrayList<Op>()
        for (raw in text.split('\n', ',', ';')) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            val ram = ramRe.matchEntire(line)
            if (ram != null) {
                ops.add(Op.Ram(ram.groupValues[1].toInt(16), ram.groupValues[2].toInt(16)))
            } else if (console == NativeEmulator.NES && ggRe.matches(line)) {
                val n = line.uppercase().map { LETTERS.indexOf(it) }
                val addr = 0x8000 + (((n[3] and 7) shl 12) or ((n[5] and 7) shl 8) or ((n[4] and 8) shl 8) or ((n[2] and 7) shl 4) or ((n[1] and 8) shl 4) or (n[4] and 7) or (n[3] and 8))
                val last = if (n.size == 8) n[7] else n[5]
                val value = ((n[1] and 7) shl 4) or ((n[0] and 8) shl 4) or (n[0] and 7) or (last and 8)
                val compare = if (n.size == 8) ((n[7] and 7) shl 4) or ((n[6] and 8) shl 4) or (n[6] and 7) or (n[5] and 8) else -1
                ops.add(Op.Gg(addr, value, compare))
            } else {
                throw IllegalArgumentException("Formato não reconhecido: \"$line\". Use ENDEREÇO:VALOR (ex.: 0075:09)" + if (console == NativeEmulator.NES) " ou Game Genie (ex.: SXIOPO)." else ".")
            }
        }
        if (ops.isEmpty()) throw IllegalArgumentException("Digite um código.")
        return ops
    }

    fun apply(ops: List<Op>) {
        NativeEmulator.nativeCheatsClear()
        for (o in ops) when (o) {
            is Op.Ram -> NativeEmulator.nativeCheatRam(o.addr, o.value)
            is Op.Gg -> NativeEmulator.nativeCheatGg(o.addr, o.value, o.compare)
        }
    }

    fun load(file: File): String = runCatching { if (file.isFile) file.readText() else "" }.getOrDefault("")
}
