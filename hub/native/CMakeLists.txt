cmake_minimum_required(VERSION 3.20)
project(emuhub_core LANGUAGES CXX)
add_library(emuhub_core STATIC src/emuhub_core.cpp)
target_include_directories(emuhub_core PUBLIC include)
target_compile_features(emuhub_core PUBLIC cxx_std_17)
set_target_properties(emuhub_core PROPERTIES POSITION_INDEPENDENT_CODE ON)
if(EMSCRIPTEN)
  add_executable(emuhub_core_wasm src/emuhub_core.cpp)
  target_include_directories(emuhub_core_wasm PRIVATE include)
  target_compile_features(emuhub_core_wasm PRIVATE cxx_std_17)
  set_target_properties(emuhub_core_wasm PROPERTIES OUTPUT_NAME "emuhub-core" SUFFIX ".js")
  target_link_options(emuhub_core_wasm PRIVATE
    "-sWASM=1"
    "-sMODULARIZE=1"
    "-sEXPORT_NAME=EmuHubCoreModule"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_emuhub_abi_version','_emuhub_video_width','_emuhub_video_height','_emuhub_video_buffer','_emuhub_video_buffer_size','_emuhub_audio_sample_rate','_emuhub_audio_buffer_size','_emuhub_audio_buffer','_emuhub_load_rom','_emuhub_reset','_emuhub_set_buttons','_emuhub_run_frame','_emuhub_destroy']"
    "-sEXPORTED_RUNTIME_METHODS=['HEAPU8','HEAPU32','HEAPF32','ccall','cwrap']"
  )
endif()
