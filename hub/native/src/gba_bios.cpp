// BIOS simulada (HLE) do GBA (porte de hub/src/cores/gba/bios.js): chamadas SWI sem precisar da BIOS real.
// Chamadas de som e MultiBoot viram no-op.
#include "gba_machine.h"
#include <cmath>

namespace emuhub {

namespace {
inline std::int32_t w32(std::int64_t x) { return static_cast<std::int32_t>(static_cast<std::uint32_t>(static_cast<std::uint64_t>(x))); }
inline std::int32_t s16(std::uint32_t v) { return static_cast<std::int16_t>(static_cast<std::uint16_t>(v)); }

std::int32_t arctan(std::int32_t i) {
  const std::int32_t a = -(w32(static_cast<std::int64_t>(i) * i) >> 14);
  std::int32_t b = (w32(0xA9ll * a) >> 14) + 0x390;
  b = (w32(static_cast<std::int64_t>(b) * a) >> 14) + 0x91C;
  b = (w32(static_cast<std::int64_t>(b) * a) >> 14) + 0xFB6;
  b = (w32(static_cast<std::int64_t>(b) * a) >> 14) + 0x16AA;
  b = (w32(static_cast<std::int64_t>(b) * a) >> 14) + 0x2081;
  b = (w32(static_cast<std::int64_t>(b) * a) >> 14) + 0x3651;
  b = (w32(static_cast<std::int64_t>(b) * a) >> 14) + 0xA2F9;
  return w32(static_cast<std::int64_t>(i) * b) >> 16;
}
std::int32_t div_trunc(std::int32_t a, std::int32_t b) { return w32(static_cast<std::int64_t>(a) / b); }
std::int32_t arctan2(std::int32_t x, std::int32_t y) {
  const auto sh14 = [](std::int32_t v) { return static_cast<std::int32_t>(static_cast<std::uint32_t>(v) << 14); };
  if (!y) return x >= 0 ? 0 : 0x8000;
  if (!x) return y >= 0 ? 0x4000 : 0xC000;
  if (y >= 0) {
    if (x >= 0) { if (x >= y) return arctan(div_trunc(sh14(y), x)); }
    else if (-x >= y) return arctan(div_trunc(sh14(y), x)) + 0x8000;
    return 0x4000 - arctan(div_trunc(sh14(x), y));
  }
  if (x <= 0) { if (-x > -y) return arctan(div_trunc(sh14(y), x)) + 0x8000; }
  else if (x >= -y) return arctan(div_trunc(sh14(y), x)) + 0x10000;
  return 0xC000 - arctan(div_trunc(sh14(x), y));
}
}  // namespace

std::vector<std::uint8_t> GbaMachine::lz77(std::uint32_t src) {
  const std::uint32_t size = read32(src) >> 8;
  std::vector<std::uint8_t> out(size);
  std::uint32_t sp = src + 4, op = 0;
  while (op < size) {
    const std::uint32_t flags = read8(sp++);
    for (int bit = 7; bit >= 0 && op < size; bit--) {
      if (flags & (1u << bit)) {
        const std::uint32_t b0 = read8(sp++), b1 = read8(sp++);
        const std::uint32_t len = (b0 >> 4) + 3, disp = (((b0 & 15) << 8) | b1) + 1;
        for (std::uint32_t k = 0; k < len && op < size; k++, op++) out[op] = op >= disp ? out[op - disp] : 0;
      } else out[op++] = static_cast<std::uint8_t>(read8(sp++));
    }
  }
  return out;
}
std::vector<std::uint8_t> GbaMachine::rle(std::uint32_t src) {
  const std::uint32_t size = read32(src) >> 8;
  std::vector<std::uint8_t> out(size);
  std::uint32_t sp = src + 4, op = 0;
  while (op < size) {
    const std::uint32_t f = read8(sp++);
    if (f & 0x80) { const std::uint32_t len = (f & 0x7F) + 3, v = read8(sp++); for (std::uint32_t k = 0; k < len && op < size; k++) out[op++] = static_cast<std::uint8_t>(v); }
    else { const std::uint32_t len = (f & 0x7F) + 1; for (std::uint32_t k = 0; k < len && op < size; k++) out[op++] = static_cast<std::uint8_t>(read8(sp++)); }
  }
  return out;
}
std::vector<std::uint8_t> GbaMachine::huff(std::uint32_t src) {
  const std::uint32_t hdr = read32(src), bits = hdr & 15, size = hdr >> 8;
  std::vector<std::uint8_t> out(size);
  const std::uint32_t tree_size = read8(src + 4), root = src + 5;
  std::uint32_t sp = src + 4 + (tree_size + 1) * 2, op = 0, node = root, acc = 0, acc_bits = 0;
  while (op < size) {
    const std::uint32_t word = read32(sp); sp += 4;
    for (int b = 31; b >= 0 && op < size; b--) {
      const std::uint32_t bit = (word >> b) & 1, nb = read8(node);
      const std::uint32_t next = (node & ~1u) + (nb & 0x3F) * 2 + 2;
      const std::uint32_t leaf = bit ? (nb & 0x40) : (nb & 0x80), target = next + bit;
      if (leaf) {
        acc |= read8(target) << acc_bits; acc_bits += bits; node = root;
        if (acc_bits >= 32) {
          for (int k = 0; k < 4 && op < size; k++) out[op++] = static_cast<std::uint8_t>((acc >> (k * 8)) & 0xFF);
          acc = 0; acc_bits = 0;
        }
      } else node = target;
    }
  }
  return out;
}
void GbaMachine::store_out(std::uint32_t dst, const std::vector<std::uint8_t>& d, bool halfwords) {
  if (halfwords) {
    for (std::size_t i = 0; i < d.size(); i += 2) write16(dst + static_cast<std::uint32_t>(i), d[i] | ((i + 1 < d.size() ? d[i + 1] : 0) << 8));
  } else for (std::size_t i = 0; i < d.size(); i++) put8(dst + static_cast<std::uint32_t>(i), d[i]);
}

bool GbaMachine::intr_wait(bool discard, std::uint32_t flags, std::uint32_t pc) {
  set_io16(0x208, 1); update_irq();
  std::uint8_t* bf = iwram_.data() + 0x7FF8;
  auto get = [&]() { std::uint16_t v; std::memcpy(&v, bf, 2); return static_cast<std::uint32_t>(v); };
  auto put = [&](std::uint32_t v) { std::uint16_t x = static_cast<std::uint16_t>(v); std::memcpy(bf, &x, 2); };
  if (!intr_waiting_) { intr_waiting_ = 1; if (discard) put(get() & ~flags); }
  const std::uint32_t cur = get();
  if (cur & flags) { put(cur & ~flags); intr_waiting_ = 0; return true; }
  cpu_.r[15] = pc; cpu_.pc_written = 1; cpu_.halted = 1;   // repete o SWI depois que a interrupção acordar a CPU
  return true;
}

void GbaMachine::ram_reset(std::uint32_t f) {
  if (f & 1) ewram_.fill(0);
  if (f & 2) std::memset(iwram_.data(), 0, 0x7E00);
  if (f & 4) pal_.fill(0);
  if (f & 8) vram_.fill(0);
  if (f & 16) oam_.fill(0);
  if (f & 0x80) {
    std::memset(io_.data(), 0, 0x60); set_io16(0, 0x80);
    for (std::uint32_t o : {0x20u, 0x26u, 0x30u, 0x36u}) set_io16(o, 0x100);
    latch_ref(0); latch_ref(1);
  }
}

bool GbaMachine::bios_swi(std::uint32_t num, std::uint32_t pc) {
  std::uint32_t* r = cpu_.r;
  const std::uint32_t n = cpu_.t ? (num & 0xFF) : ((num >> 16) & 0xFF);
  switch (n) {
    case 0x00: soft_reset(); return true;
    case 0x01: ram_reset(r[0]); return true;
    case 0x02: case 0x03: cpu_.halted = 1; return true;
    case 0x04: return intr_wait((r[0] & 1) != 0, r[1] & 0xFFFF, pc);
    case 0x05: return intr_wait(true, 1, pc);
    case 0x06: case 0x07: {
      const std::int32_t num2 = static_cast<std::int32_t>(n == 6 ? r[0] : r[1]), den = static_cast<std::int32_t>(n == 6 ? r[1] : r[0]);
      if (den == 0) { r[0] = num2 < 0 ? 0xFFFFFFFFu : 1; r[1] = static_cast<std::uint32_t>(num2); r[3] = 1; return true; }
      const std::int32_t q = div_trunc(num2, den);
      const std::int32_t rem = static_cast<std::int32_t>(static_cast<std::uint32_t>(num2) - static_cast<std::uint32_t>(q) * static_cast<std::uint32_t>(den));
      r[0] = static_cast<std::uint32_t>(q); r[1] = static_cast<std::uint32_t>(rem);
      r[3] = q < 0 ? static_cast<std::uint32_t>(-static_cast<std::int64_t>(q)) : static_cast<std::uint32_t>(q);
      return true;
    }
    case 0x08: r[0] = static_cast<std::uint32_t>(std::floor(std::sqrt(static_cast<double>(r[0])))); return true;
    case 0x09: r[0] = static_cast<std::uint32_t>(arctan(static_cast<std::int32_t>(r[0]))); return true;
    case 0x0A: r[0] = static_cast<std::uint32_t>(arctan2(static_cast<std::int32_t>(r[0]), static_cast<std::int32_t>(r[1]))) & 0xFFFF; return true;
    case 0x0B: case 0x0C: {
      std::uint32_t src = r[0] & ~1u, dst = r[1] & ~1u, cnt = r[2] & 0x1FFFFF;
      const bool fill = (r[2] & 0x1000000) != 0, word = n == 0x0C || (r[2] & 0x4000000) != 0;
      if (n == 0x0C) cnt = (cnt + 7) & ~7u;
      if (word) {
        src &= ~3u; dst &= ~3u;
        const std::uint32_t f = fill ? read32(src) : 0;
        for (std::uint32_t i = 0; i < cnt; i++) { write32(dst, fill ? f : read32(src)); if (!fill) src += 4; dst += 4; }
      } else {
        const std::uint32_t f = fill ? read16(src) : 0;
        for (std::uint32_t i = 0; i < cnt; i++) { write16(dst, fill ? f : read16(src)); if (!fill) src += 2; dst += 2; }
      }
      return true;
    }
    case 0x0D: r[0] = 0xBAAE187F; return true;
    case 0x0E: {   // BgAffineSet
      std::uint32_t src = r[0], dst = r[1];
      for (std::uint32_t k = 0; k < r[2]; k++, src += 20, dst += 16) {
        const std::int32_t ox = static_cast<std::int32_t>(read32(src)), oy = static_cast<std::int32_t>(read32(src + 4));
        const std::int32_t dx = s16(read16(src + 8)), dy = s16(read16(src + 10));
        const std::int32_t sx = s16(read16(src + 12)), sy = s16(read16(src + 14));
        const double th = (read16(src + 16) >> 8) / 128.0 * M_PI, c = std::cos(th), s = std::sin(th);
        const std::int32_t pa = static_cast<std::int32_t>(std::trunc(c * sx)), pb = static_cast<std::int32_t>(std::trunc(-s * sx));
        const std::int32_t pc2 = static_cast<std::int32_t>(std::trunc(s * sy)), pd = static_cast<std::int32_t>(std::trunc(c * sy));
        write16(dst, static_cast<std::uint32_t>(pa) & 0xFFFF); write16(dst + 2, static_cast<std::uint32_t>(pb) & 0xFFFF);
        write16(dst + 4, static_cast<std::uint32_t>(pc2) & 0xFFFF); write16(dst + 6, static_cast<std::uint32_t>(pd) & 0xFFFF);
        write32(dst + 8, static_cast<std::uint32_t>(static_cast<std::int64_t>(ox) - (static_cast<std::int64_t>(pa) * dx + static_cast<std::int64_t>(pb) * dy)));
        write32(dst + 12, static_cast<std::uint32_t>(static_cast<std::int64_t>(oy) - (static_cast<std::int64_t>(pc2) * dx + static_cast<std::int64_t>(pd) * dy)));
      }
      return true;
    }
    case 0x0F: {   // ObjAffineSet
      std::uint32_t src = r[0], dst = r[1];
      const std::uint32_t off = r[3];
      for (std::uint32_t k = 0; k < r[2]; k++, src += 8) {
        const std::int32_t sx = s16(read16(src)), sy = s16(read16(src + 2));
        const double th = (read16(src + 4) >> 8) / 128.0 * M_PI, c = std::cos(th), s = std::sin(th);
        write16(dst, static_cast<std::uint32_t>(static_cast<std::int32_t>(std::trunc(c * sx))) & 0xFFFF);
        write16(dst + off, static_cast<std::uint32_t>(static_cast<std::int32_t>(std::trunc(-s * sx))) & 0xFFFF);
        write16(dst + off * 2, static_cast<std::uint32_t>(static_cast<std::int32_t>(std::trunc(s * sy))) & 0xFFFF);
        write16(dst + off * 3, static_cast<std::uint32_t>(static_cast<std::int32_t>(std::trunc(c * sy))) & 0xFFFF);
        dst += off * 4;
      }
      return true;
    }
    case 0x10: {   // BitUnPack
      const std::uint32_t info = r[2], len = read16(info), sw = read8(info + 2), dw = read8(info + 3), off = read32(info + 4);
      const bool zero = (off >> 31) != 0;
      const std::uint32_t offv = off & 0x7FFFFFFF, mask = sw >= 32 ? 0xFFFFFFFFu : (1u << sw) - 1;
      std::uint32_t src = r[0], dst = r[1], acc = 0, bits = 0;
      for (std::uint32_t i = 0; i < len; i++) {
        const std::uint32_t b = read8(src++);
        for (std::uint32_t k = 0; k < 8; k += (sw ? sw : 8)) {
          std::uint32_t v = (b >> k) & mask;
          if (v || zero) v += offv;
          if (bits < 32) acc |= v << bits;
          bits += dw;
          if (bits >= 32) { write32(dst, acc); dst += 4; acc = 0; bits = 0; }
        }
      }
      return true;
    }
    case 0x11: store_out(r[1], lz77(r[0]), false); return true;
    case 0x12: store_out(r[1], lz77(r[0]), true); return true;
    case 0x13: store_out(r[1], huff(r[0]), false); return true;
    case 0x14: store_out(r[1], rle(r[0]), false); return true;
    case 0x15: store_out(r[1], rle(r[0]), true); return true;
    case 0x16: case 0x17: {   // Diff 8 bits
      const std::uint32_t size = read32(r[0]) >> 8;
      std::vector<std::uint8_t> out(size);
      std::uint32_t acc = 0;
      for (std::uint32_t i = 0; i < size; i++) { acc = (acc + read8(r[0] + 4 + i)) & 0xFF; out[i] = static_cast<std::uint8_t>(acc); }
      store_out(r[1], out, n == 0x17); return true;
    }
    case 0x18: {   // Diff 16 bits
      const std::uint32_t size = read32(r[0]) >> 8;
      std::uint32_t acc = 0;
      for (std::uint32_t i = 0; i < size; i += 2) { acc = (acc + read16(r[0] + 4 + i)) & 0xFFFF; write16(r[1] + i, acc); }
      return true;
    }
    default: return true;   // som, MultiBoot, etc.: sem efeito
  }
}

}  // namespace emuhub
