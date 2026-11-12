#pragma once
#include <cstddef>
#include <cstdint>

namespace emuhub {

struct SnesHeader {
  bool ok = false, hirom = false, copier = false, coprocessor = false, battery = false;
  int map = 0;  // 0 LoROM, 1 HiROM, 2 ExHiROM
  int chip = -1;
  std::size_t sram_kb = 0;
};

/* Mesma heurística do núcleo JS (parseSnesHeader): pontua checksum, bit de mapeamento e título ASCII. */
inline SnesHeader parse_snes_header(const std::uint8_t* d, std::size_t len) {
  SnesHeader h;
  const std::size_t off = (len % 1024 == 512) ? 512 : 0;
  const std::size_t cand[3] = {0x7FC0, 0xFFC0, 0x40FFC0};
  int best_score = -1, best_map = 0; std::size_t best_a = 0;
  for (int m = 0; m < 3; m++) {
    const std::size_t a = cand[m] + off;
    if (a + 32 > len) continue;
    const int comp = d[a + 0x1C] | (d[a + 0x1D] << 8), chk = d[a + 0x1E] | (d[a + 0x1F] << 8);
    int score = 0;
    if (((comp + chk) & 0xFFFF) == 0xFFFF) score += 4;
    const bool is_hi = (d[a + 0x15] & 1) == 1;
    if ((m == 0) == !is_hi) score += 2;
    bool ascii = true;
    for (int i = 0; i < 21; i++) { const int ch = d[a + i]; if (ch < 0x20 || ch > 0x7E) { ascii = false; break; } }
    if (ascii) score += 2;
    if (best_score < 0 || score > best_score) { best_score = score; best_map = m; best_a = a; }
  }
  if (best_score < 4) return h;
  const int type = d[best_a + 0x16], sram = d[best_a + 0x18];
  h.ok = true; h.map = best_map; h.hirom = best_map != 0; h.copier = off > 0;
  h.sram_kb = sram ? (static_cast<std::size_t>(1) << (sram & 31)) : 0;
  h.coprocessor = (type & 0x0F) >= 3;
  h.chip = h.coprocessor ? (type >> 4) : -1;
  const int t = type & 0x0F; h.battery = t == 2 || t == 5 || t == 6 || t == 9 || t == 10;
  return h;
}

}  // namespace emuhub
