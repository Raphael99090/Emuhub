#include <jni.h>
#include <algorithm>
#include <cstdint>
#include <vector>
#include <mutex>

namespace { std::mutex g_core_mutex; }
#include "emuhub_core.h"

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeAbi(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    return static_cast<jint>(emuhub_abi_version());
}

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeSelectConsole(JNIEnv*, jclass, jint console) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    return emuhub_select_console(console);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeLoadRom(JNIEnv* env, jclass, jbyteArray bytes) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    if (!bytes) return -1;
    const jsize size = env->GetArrayLength(bytes);
    std::vector<std::uint8_t> rom(static_cast<std::size_t>(size));
    env->GetByteArrayRegion(bytes, 0, size, reinterpret_cast<jbyte*>(rom.data()));
    if (env->ExceptionCheck()) return -2;
    return emuhub_load_rom(rom.data(), rom.size());
}

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeRunFrame(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    return emuhub_run_frame();
}

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeWidth(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    return static_cast<jint>(emuhub_video_width());
}

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeHeight(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    return static_cast<jint>(emuhub_video_height());
}

extern "C" JNIEXPORT jintArray JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeFrame(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
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
    std::lock_guard<std::mutex> lock(g_core_mutex);
    emuhub_set_buttons(static_cast<std::uint16_t>(mask));
}

extern "C" JNIEXPORT void JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeReset(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    emuhub_reset();
}

extern "C" JNIEXPORT void JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeDestroy(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    emuhub_destroy();
}

extern "C" JNIEXPORT void JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeNeoClearFiles(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    emuhub_neo_clear_files();
}

extern "C" JNIEXPORT void JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeNeoAddFile(JNIEnv* env, jclass, jstring name, jbyteArray bytes) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    if (!name || !bytes) return;
    const char* n = env->GetStringUTFChars(name, nullptr);
    if (!n) return;
    const jsize size = env->GetArrayLength(bytes);
    std::vector<std::uint8_t> data(static_cast<std::size_t>(size));
    env->GetByteArrayRegion(bytes, 0, size, reinterpret_cast<jbyte*>(data.data()));
    if (!env->ExceptionCheck()) emuhub_neo_add_file(n, data.data(), data.size());
    env->ReleaseStringUTFChars(name, n);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeNeoSetBios(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    return emuhub_neo_set_bios();
}

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeNeoHasBios(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    return emuhub_neo_has_bios();
}

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeNeoLoadSet(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    return emuhub_neo_load_set();
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeNeoError(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    return env->NewStringUTF(emuhub_neo_error());
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeAudio(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    const std::size_t n = emuhub_audio_buffer_samples();
    jfloatArray out = env->NewFloatArray(static_cast<jsize>(n));
    if (out && n) env->SetFloatArrayRegion(out, 0, static_cast<jsize>(n), emuhub_audio_buffer());
    return out;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeSampleRate(JNIEnv*, jclass) {
    return static_cast<jint>(emuhub_audio_sample_rate());
}

extern "C" JNIEXPORT void JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeVolume(JNIEnv*, jclass, jfloat volume) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    emuhub_set_audio_volume(volume);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeSramBattery(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    return emuhub_sram_size() > 0 ? emuhub_sram_battery() : 0;
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeSramGet(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    const std::size_t n = emuhub_sram_size();
    const auto* p = emuhub_sram_data();
    if (!p || n == 0) return nullptr;
    jbyteArray out = env->NewByteArray(static_cast<jsize>(n));
    if (out) env->SetByteArrayRegion(out, 0, static_cast<jsize>(n), reinterpret_cast<const jbyte*>(p));
    return out;
}

extern "C" JNIEXPORT void JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeSramSet(JNIEnv* env, jclass, jbyteArray bytes) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    auto* p = emuhub_sram_data();
    const std::size_t n = emuhub_sram_size();
    if (!p || !bytes || n == 0) return;
    const std::size_t len = std::min<std::size_t>(n, static_cast<std::size_t>(env->GetArrayLength(bytes)));
    env->GetByteArrayRegion(bytes, 0, static_cast<jsize>(len), reinterpret_cast<jbyte*>(p));
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeStateSave(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    const std::size_t n = emuhub_state_save();
    const auto* p = emuhub_state_buffer();
    if (!p || n == 0) return nullptr;
    jbyteArray out = env->NewByteArray(static_cast<jsize>(n));
    if (out) env->SetByteArrayRegion(out, 0, static_cast<jsize>(n), reinterpret_cast<const jbyte*>(p));
    return out;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeStateLoad(JNIEnv* env, jclass, jbyteArray bytes) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    if (!bytes) return -1;
    const std::size_t n = static_cast<std::size_t>(env->GetArrayLength(bytes));
    auto* p = emuhub_state_alloc(n);
    if (!p) return -2;
    env->GetByteArrayRegion(bytes, 0, static_cast<jsize>(n), reinterpret_cast<jbyte*>(p));
    return emuhub_state_load(n);
}

extern "C" JNIEXPORT void JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeCheatsClear(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    emuhub_cheats_clear();
}

extern "C" JNIEXPORT void JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeCheatRam(JNIEnv*, jclass, jint addr, jint value) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    emuhub_cheat_ram(static_cast<std::uint32_t>(addr), value);
}

extern "C" JNIEXPORT void JNICALL
Java_com_rapzin_emuhub_nativeapp_NativeEmulator_nativeCheatGg(JNIEnv*, jclass, jint addr, jint value, jint compare) {
    std::lock_guard<std::mutex> lock(g_core_mutex);
    emuhub_cheat_gg(static_cast<std::uint32_t>(addr), value, compare);
}
