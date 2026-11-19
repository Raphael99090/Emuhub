// SPDX-License-Identifier: GPL-3.0-or-later
package com.rapzin.emuhub.nativeapp

import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInteropFilter
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.min

/** Botão de um grupo: posição e tamanho em frações do grupo. */
private class PadBtn(val label: String, val bit: Int, val cx: Float, val cy: Float, val w: Float, val h: Float, val color: Color, val round: Boolean)

private fun setTouch(mask: Int, bits: Int) {
    InputState.touch = (InputState.touch and bits.inv()) or (mask and bits)
    InputState.push()
}

/** Direcional redondo: setores de ~64° para as direções e ~26° para as diagonais, e dá pra deslizar o dedo. */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun DPad(size: Dp, haptics: Boolean) {
    val view = LocalView.current
    var mask by remember { mutableIntStateOf(0) }
    var ptr by remember { mutableIntStateOf(-1) }
    var px by remember { mutableFloatStateOf(0f) }
    fun update(x: Float, y: Float) {
        val r = px / 2
        val dx = (x - r) / r; val dy = (y - r) / r
        var m = 0
        if (hypot(dx, dy) > 0.2f) {
            val a = Math.toDegrees(atan2(dy, dx).toDouble()).toFloat(); val aa = abs(a)
            val hor = if (aa < 32) 1 else if (aa > 148) -1 else 0
            val ver = if (aa > 58 && aa < 122) (if (a > 0) 1 else -1) else 0
            if (hor != 0 || ver != 0) {
                if (hor > 0) m = m or 128 else if (hor < 0) m = m or 64
                if (ver > 0) m = m or 32 else if (ver < 0) m = m or 16
            } else {
                m = m or (if (aa < 90) 128 else 64)
                m = m or (if (a > 0) 32 else 16)
            }
        }
        if (m != mask) { if (haptics && m != 0) view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP); mask = m; setTouch(m, 240) }
    }
    fun release() { ptr = -1; mask = 0; setTouch(0, 240) }
    val rx = (if (mask and 16 != 0) 1 else 0) - (if (mask and 32 != 0) 1 else 0)
    val ry = (if (mask and 128 != 0) 1 else 0) - (if (mask and 64 != 0) 1 else 0)
    Box(
        Modifier.size(size).onSizeChanged { px = it.width.toFloat() }
            .clip(CircleShape).background(Brush.radialGradient(listOf(Color(0xFF1D2029), Color(0xFF0E1015))))
            .pointerInteropFilter { e ->
                when (e.actionMasked) {
                    MotionEvent.ACTION_DOWN -> { ptr = e.getPointerId(0); update(e.getX(0), e.getY(0)) }
                    MotionEvent.ACTION_MOVE -> { val i = e.findPointerIndex(ptr); if (i >= 0) update(e.getX(i), e.getY(i)) }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> release()
                }
                true
            }
    ) {
        Canvas(Modifier.fillMaxSize().graphicsLayer { rotationX = rx * 11f; rotationY = ry * 11f; cameraDistance = 14f * density }) {
            val w = this.size.width
            fun p(x: Float, y: Float) = Offset(x * w, y * w)
            val cross = Path().apply {
                moveTo(p(.35f, .06f).x, p(.35f, .06f).y); lineTo(p(.65f, .06f).x, p(.65f, .06f).y); lineTo(p(.65f, .35f).x, p(.65f, .35f).y)
                lineTo(p(.94f, .35f).x, p(.94f, .35f).y); lineTo(p(.94f, .65f).x, p(.94f, .65f).y); lineTo(p(.65f, .65f).x, p(.65f, .65f).y)
                lineTo(p(.65f, .94f).x, p(.65f, .94f).y); lineTo(p(.35f, .94f).x, p(.35f, .94f).y); lineTo(p(.35f, .65f).x, p(.35f, .65f).y)
                lineTo(p(.06f, .65f).x, p(.06f, .65f).y); lineTo(p(.06f, .35f).x, p(.06f, .35f).y); lineTo(p(.35f, .35f).x, p(.35f, .35f).y); close()
            }
            drawPath(cross, Brush.verticalGradient(listOf(Color(0xFF4A5062), Color(0xFF2F3441), Color(0xFF232731))))
            drawCircle(Color(0xFF1B1E26), radius = w * 0.09f, center = Offset(w / 2, w / 2))
            // marca da direção acionada
            fun mark(on: Boolean, x: Float, y: Float) { if (on) drawCircle(Color(0xFF9A78FF), radius = w * 0.07f, center = p(x, y)) }
            mark(mask and 16 != 0, .5f, .2f); mark(mask and 32 != 0, .5f, .8f); mark(mask and 64 != 0, .2f, .5f); mark(mask and 128 != 0, .8f, .5f)
        }
    }
}

/** Grupo de botões num só toque: o dedo pode deslizar de um botão para outro sem levantar, e a área de toque é maior que o desenho. */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun Cluster(width: Dp, height: Dp, buttons: List<PadBtn>, haptics: Boolean) {
    val view = LocalView.current
    val bits = remember(buttons) { buttons.fold(0) { a, b -> a or b.bit } }
    var pressed by remember { mutableIntStateOf(0) }
    val held = remember { HashMap<Int, Int>() }
    var wpx by remember { mutableFloatStateOf(1f) }
    var hpx by remember { mutableFloatStateOf(1f) }
    fun at(x: Float, y: Float): Int {
        var best = -1; var bd = Float.MAX_VALUE
        buttons.forEachIndexed { i, b ->
            val cx = b.cx * wpx; val cy = b.cy * hpx
            val hw = b.w * wpx / 2 * 1.3f; val hh = b.h * hpx / 2 * 1.3f
            if (abs(x - cx) <= hw && abs(y - cy) <= hh) { val d = hypot(x - cx, y - cy); if (d < bd) { bd = d; best = i } }
        }
        return best
    }
    fun sync() {
        var m = 0
        for (i in held.values) if (i >= 0) m = m or buttons[i].bit
        if (m != pressed) {
            if (haptics && (m and pressed.inv()) != 0) view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            pressed = m; setTouch(m, bits)
        }
    }
    Box(
        Modifier.size(width, height).onSizeChanged { wpx = it.width.toFloat(); hpx = it.height.toFloat() }
            .pointerInteropFilter { e ->
                when (e.actionMasked) {
                    MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                        val i = e.actionIndex; held[e.getPointerId(i)] = at(e.getX(i), e.getY(i)); sync()
                    }
                    MotionEvent.ACTION_MOVE -> {
                        for (i in 0 until e.pointerCount) { val id = e.getPointerId(i); if (held.containsKey(id)) held[id] = at(e.getX(i), e.getY(i)) }
                        sync()
                    }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> { held.remove(e.getPointerId(e.actionIndex)); if (e.actionMasked == MotionEvent.ACTION_UP) held.clear(); sync() }
                    MotionEvent.ACTION_CANCEL -> { held.clear(); sync() }
                }
                true
            }
    ) {
        for (b in buttons) {
            val on = pressed and b.bit != 0
            val bw = width * b.w; val bh = height * b.h
            Box(
                Modifier.offset(width * b.cx - bw / 2, height * b.cy - bh / 2).size(bw, bh)
                    .graphicsLayer { val s = if (on) 0.93f else 1f; scaleX = s; scaleY = s; translationY = if (on) 3f * density else 0f }
                    .clip(if (b.round) CircleShape else RoundedCornerShape(50))
                    .background(
                        if (b.round) Brush.verticalGradient(
                            listOf(if (on) b.color.copy(alpha = .75f) else lerpWhite(b.color), if (on) b.color.copy(alpha = .6f) else b.color)
                        ) else Brush.verticalGradient(listOf(if (on) Color(0xFF14161C) else Color(0xFF313644), if (on) Color(0xFF1F232D) else Color(0xFF1B1E27)))
                    ),
                contentAlignment = Alignment.Center
            ) {
                Text(b.label, color = Color.White, fontWeight = FontWeight.ExtraBold, maxLines = 1, softWrap = false,
                    fontSize = if (b.round) 17.sp else 11.sp, letterSpacing = if (b.round) 0.sp else 1.sp)
            }
        }
    }
}

private fun lerpWhite(c: Color) = Color(c.red + (1 - c.red) * .28f, c.green + (1 - c.green) * .28f, c.blue + (1 - c.blue) * .28f, 1f)

private val Blue = Color(0xFF4D7CF0)
private val Green = Color(0xFF3FAE78)
private val Red = Color(0xFFE4483B)
private val Yellow = Color(0xFFD9AA35)

private fun faceButtons(console: Int): List<PadBtn> = when (console) {
    NativeEmulator.SNES -> listOf(
        PadBtn("X", 256, .5f, .17f, .34f, .34f, Blue, true), PadBtn("Y", 512, .17f, .5f, .34f, .34f, Green, true),
        PadBtn("A", 1, .83f, .5f, .34f, .34f, Red, true), PadBtn("B", 2, .5f, .83f, .34f, .34f, Yellow, true))
    NativeEmulator.NEO_GEO -> listOf(
        PadBtn("C", 256, .5f, .17f, .34f, .34f, Blue, true), PadBtn("D", 512, .17f, .5f, .34f, .34f, Green, true),
        PadBtn("A", 1, .83f, .5f, .34f, .34f, Red, true), PadBtn("B", 2, .5f, .83f, .34f, .34f, Yellow, true))
    NativeEmulator.GBA -> listOf(
        PadBtn("A", 1, .74f, .36f, .46f, .46f, Red, true), PadBtn("B", 2, .26f, .64f, .46f, .46f, Red, true))
    else -> listOf(
        PadBtn("A", 1, .74f, .36f, .46f, .46f, Red, true), PadBtn("B", 2, .26f, .64f, .46f, .46f, Red, true))
}

private fun sysButtons(console: Int): List<Pair<String, Int>> = when (console) {
    NativeEmulator.MASTER_SYSTEM -> listOf("PAUSE" to 8)
    NativeEmulator.GAME_GEAR -> listOf("START" to 8)
    NativeEmulator.NEO_GEO -> listOf("COIN" to 4, "START" to 8)
    else -> listOf("SELECT" to 4, "START" to 8)
}

@Composable
private fun Sys(items: List<Pair<String, Int>>, haptics: Boolean) {
    val w = 96.dp * items.size + 8.dp * (items.size - 1)
    val n = items.size
    Cluster(w, 38.dp, items.mapIndexed { i, (l, b) -> PadBtn(l, b, (i + .5f) / n, .5f, (1f / n) - .06f, .84f, Color.Gray, false) }, haptics)
}

@Composable
private fun Shoulder(label: String, bit: Int, haptics: Boolean) =
    Cluster(120.dp, 38.dp, listOf(PadBtn(label, bit, .5f, .5f, 1f, .9f, Color.Gray, false)), haptics)

private fun hasShoulders(console: Int) = console == NativeEmulator.SNES || console == NativeEmulator.GBA

/** Controles de toque: part 0 = retrato (tudo), 1 = lado esquerdo da tela deitada, 2 = lado direito. */
@Composable
internal fun GameControls(console: Int, part: Int = 0) {
    val context = LocalContext.current
    val haptics = remember { AppSettings.haptics(context) }
    val cfg = LocalConfiguration.current
    val land = part != 0
    val dp = min(if (land) 150f else 170f, if (land) cfg.screenHeightDp * 0.4f else cfg.screenWidthDp * 0.44f).dp
    val sys = sysButtons(console)
    val face = faceButtons(console)
    val fw = dp * (if (land) 1f else 1f)
    when (part) {
        1 -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (hasShoulders(console)) Shoulder("L", 1024, haptics)
            DPad(dp, haptics)
            if (sys.size > 1) Sys(listOf(sys[0]), haptics)
        }
        2 -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (hasShoulders(console)) Shoulder("R", 2048, haptics)
            Cluster(fw, fw, face, haptics)
            Sys(listOf(sys.last()), haptics)
        }
        else -> Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (hasShoulders(console)) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Shoulder("L", 1024, haptics); Shoulder("R", 2048, haptics)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                DPad(dp, haptics); Cluster(fw, fw, face, haptics)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { Sys(sys, haptics) }
        }
    }
}
