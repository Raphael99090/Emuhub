// SPDX-License-Identifier: GPL-3.0-or-later
package com.rapzin.emuhub.nativeapp

import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent

/** Junta os botões da tela, do teclado e do controle numa máscara só para o núcleo. */
internal object InputState {
    @Volatile var touch = 0
    @Volatile var pad = 0
    @Volatile var console = NativeEmulator.NES
    @Volatile var gameActive = false

    fun push() { if (NativeEmulator.available) NativeEmulator.nativeButtons(touch or pad) }

    private fun select() = 4

    private fun bitFor(code: Int): Int = when (code) {
        KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_W -> 16
        KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_S -> 32
        KeyEvent.KEYCODE_DPAD_LEFT -> 64
        KeyEvent.KEYCODE_DPAD_RIGHT -> 128
        KeyEvent.KEYCODE_BUTTON_A, KeyEvent.KEYCODE_Z -> 2        // botão de baixo = B (layout Nintendo)
        KeyEvent.KEYCODE_BUTTON_B, KeyEvent.KEYCODE_X -> 1        // botão da direita = A
        KeyEvent.KEYCODE_BUTTON_X -> if (console == NativeEmulator.NEO_GEO) 256 else 0
        KeyEvent.KEYCODE_BUTTON_Y -> if (console == NativeEmulator.NEO_GEO) 512 else 0
        KeyEvent.KEYCODE_BUTTON_L1 -> 1024
        KeyEvent.KEYCODE_BUTTON_R1 -> 2048
        KeyEvent.KEYCODE_BUTTON_START, KeyEvent.KEYCODE_ENTER -> 8
        KeyEvent.KEYCODE_BUTTON_SELECT, KeyEvent.KEYCODE_SHIFT_RIGHT, KeyEvent.KEYCODE_DEL -> select()
        else -> 0
    }

    /** Retorna true se o evento era do jogo e foi consumido. */
    fun onKey(e: KeyEvent): Boolean {
        if (!gameActive) return false
        val bit = bitFor(e.keyCode)
        if (bit == 0) return false
        if (e.action == KeyEvent.ACTION_DOWN) pad = pad or bit
        else if (e.action == KeyEvent.ACTION_UP) pad = pad and bit.inv()
        push()
        return true
    }

    /** Direcional analógico e HAT viram o direcional digital. */
    fun onMotion(e: MotionEvent): Boolean {
        if (!gameActive || (e.source and InputDevice.SOURCE_JOYSTICK) != InputDevice.SOURCE_JOYSTICK || e.action != MotionEvent.ACTION_MOVE) return false
        val x = if (Math.abs(e.getAxisValue(MotionEvent.AXIS_HAT_X)) > .5f) e.getAxisValue(MotionEvent.AXIS_HAT_X) else e.getAxisValue(MotionEvent.AXIS_X)
        val y = if (Math.abs(e.getAxisValue(MotionEvent.AXIS_HAT_Y)) > .5f) e.getAxisValue(MotionEvent.AXIS_HAT_Y) else e.getAxisValue(MotionEvent.AXIS_Y)
        var dir = 0
        if (y < -.5f) dir = dir or 16
        if (y > .5f) dir = dir or 32
        if (x < -.5f) dir = dir or 64
        if (x > .5f) dir = dir or 128
        pad = (pad and (16 or 32 or 64 or 128).inv()) or dir
        push()
        return true
    }
}
