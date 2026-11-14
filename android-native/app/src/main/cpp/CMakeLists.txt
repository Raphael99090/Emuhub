cmake_minimum_required(VERSION 3.22.1)
project(emuhub_android LANGUAGES CXX)

set(EMU_NATIVE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../hub/native")
add_subdirectory("${EMU_NATIVE_DIR}" emuhub-core-build)

add_library(emuhub_jni SHARED jni_bridge.cpp)
target_compile_features(emuhub_jni PRIVATE cxx_std_17)
target_include_directories(emuhub_jni PRIVATE "${EMU_NATIVE_DIR}/include")
target_link_libraries(emuhub_jni PRIVATE emuhub_core)
