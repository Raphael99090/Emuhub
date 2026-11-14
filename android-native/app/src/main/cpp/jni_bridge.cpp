#include <jni.h>
#include <algorithm>
#include <cstdint>
#include <vector>
#include "emuhub_core.h"

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeAbi(JNIEnv*, jclass) {
    return static_cast<jint>(emuhub_abi_version());
}

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeSelectConsole(JNIEnv*, jclass, jint console) {
    return emuhub_select_console(console);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeLoadRom(JNIEnv* env, jclass, jbyteArray bytes) {
    if (!bytes) return -1;
    const jsize size = env->GetArrayLength(bytes);
    std::vector<std::uint8_t> rom(static_cast<std::size_t>(size));
    env->GetByteArrayRegion(bytes, 0, size, reinterpret_cast<jbyte*>(rom.data()));
    if (env->ExceptionCheck()) return -2;
    return emuhub_load_rom(rom.data(), rom.size());
}

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeRunFrame(JNIEnv*, jclass) {
    return emuhub_run_frame();
}

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeWidth(JNIEnv*, jclass) {
    return static_cast<jint>(emuhub_video_width());
}

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeHeight(JNIEnv*, jclass) {
    return static_cast<jint>(emuhub_video_height());
}

extern "C" JNIEXPORT jintArray JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeFrame(JNIEnv* env, jclass) {
    const std::size_t n = emuhub_video_buffer_size();
    const auto* src = emuhub_video_buffer();
    if (!src || n == 0 || n > 512u * 512u) return nullptr;
    jintArray out = env->NewIntArray(static_cast<jsize>(n));
    if (!out) return nullptr;
    env->SetIntArrayRegion(out, 0, static_cast<jsize>(n), reinterpret_cast<const jint*>(src));
    return out;
}

extern "C" JNIEXPORT void JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeButtons(JNIEnv*, jclass, jint mask) {
    emuhub_set_buttons(static_cast<std::uint16_t>(mask));
}

extern "C" JNIEXPORT void JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeReset(JNIEnv*, jclass) {
    emuhub_reset();
}

extern "C" JNIEXPORT void JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeDestroy(JNIEnv*, jclass) {
    emuhub_destroy();
}
