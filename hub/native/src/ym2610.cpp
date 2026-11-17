#include "ym2610.h"
#include <algorithm>
#include <cmath>
#include <cstring>

namespace emuhub {

namespace {
struct Tables {
  float sin_[1024], amp[1024], ssgv[32];
  Tables() {
    for (int i = 0; i < 1024; i++) {
      sin_[i] = static_cast<float>(std::sin((i + 0.5) / 1024 * 2 * M_PI));
      amp[i] = static_cast<float>(std::pow(10.0, -i * 0.09375 / 20));
    }
    for (int i = 0; i < 32; i++) ssgv[i] = i == 0 ? 0.0f : static_cast<float>(std::pow(10.0, -(31 - i) * 1.5 / 20) / 3);
  }
};
const Tables& T() { static const Tables t; return t; }
const int kEgInc[4][8] = {{0, 1, 0, 1, 0, 1, 0, 1}, {0, 1, 0, 1, 1, 1, 0, 1}, {0, 1, 1, 1, 0, 1, 1, 1}, {0, 1, 1, 1, 1, 1, 1, 1}};
const int kSlot[4] = {0, 2, 1, 3};
const double kMul[16] = {0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15};
const int kStep[49] = {16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552};
const int kAdj[8] = {-1, -1, -1, -1, 2, 5, 7, 9}, kBAdj[8] = {57, 57, 57, 57, 77, 102, 128, 153};
const std::size_t kMask = Ym2610::kBuf - 1;
}  // namespace

Ym2610::Ym2610() { reset(); }

void Ym2610::reset() {
  std::memset(r_, 0, sizeof r_);
  std::memset(&k_, 0, sizeof k_);
  for (int i = 0; i < 24; i++) { k_.att[i] = 1023; k_.st[i] = 4; k_.dtm[i] = 1; }
  for (int i = 0; i < 3; i++) k_.s_out[i] = 1;
  k_.n_out = 1; k_.lfsr = 1; k_.b_delta = 127;
}

std::size_t Ym2610::buffered() const {
  return static_cast<std::size_t>(std::floor(static_cast<double>(wp_ - rp_) * host_sr_ / rate_));
}
void Ym2610::fill(float* out, std::size_t n) {
  const double step = rate_ / host_sr_;
  for (std::size_t i = 0; i < n; i++) {
    if (rp_ + 1 < wp_) {
      const double i0 = std::floor(pos_), f = pos_ - i0, a = abuf_[rp_ & kMask], b = abuf_[(rp_ + 1) & kMask];
      last_ = a + (b - a) * f;
      pos_ += step;
      const double adv = std::floor(pos_);
      pos_ -= adv;
      rp_ += static_cast<std::uint64_t>(adv);
      if (rp_ > wp_) rp_ = wp_;
    } else last_ *= 0.995;
    out[i] = static_cast<float>(last_ * volume_);
  }
}

std::uint32_t Ym2610::read(int p) {
  if (p == 0) return k_.flags & 3;
  if (p == 1) { const int a = addr_[0]; return a < 16 ? r_[0][a] : 0; }
  if (p == 2) return k_.a_flags | (k_.b_flag ? 0x80 : 0);
  return 0;
}
void Ym2610::write(int p, std::uint32_t v) {
  v &= 255;
  if ((p & 1) == 0) { addr_[p >> 1] = static_cast<std::int32_t>(v); return; }
  const int port = p >> 1, a = addr_[port];
  r_[port][a] = static_cast<std::uint8_t>(v);
  if (port == 0) wa(a, v); else wb(a, v);
}
void Ym2610::update_irq() { k_.irq = (((k_.flags & 1) && (r_[0][0x27] & 4)) || ((k_.flags & 2) && (r_[0][0x27] & 8))) ? 1 : 0; }

void Ym2610::wa(int a, std::uint32_t v) {
  if (a == 13) {   // escrever no registrador 13 do SSG reinicia o envelope
    const int att = v & 4;
    k_.e_dir = att ? 1 : 0; k_.e_vol = att ? 0 : 31; k_.e_step = 0; k_.e_hold = 0; k_.e_cnt = 0;
  }
  if (a < 0x10) return;
  if (a < 0x20) {   // ADPCM-B
    if (a == 0x10) {
      if (v & 1) k_.b_on = 0;
      else if (v & 0x80) {
        k_.b_on = 1; k_.b_addr = ((r_[0][0x13] << 8) | r_[0][0x12]) * 256; k_.b_end = (((r_[0][0x15] << 8) | r_[0][0x14]) + 1) * 256;
        k_.b_acc = 0; k_.b_delta = 127; k_.b_pos = 1; k_.b_nib_left = 0; k_.b_flag = 0;
      }
    } else if (a == 0x1C) { if (v & 0x80) { k_.a_flags = 0; k_.b_flag = 0; } else k_.a_flags &= ~static_cast<std::int32_t>(v & 0x3F); }
    return;
  }
  switch (a) {
    case 0x24: case 0x25: break;
    case 0x27: {
      if (v & 0x10) k_.flags &= ~1;
      if (v & 0x20) k_.flags &= ~2;
      if ((v & 1) && !k_.ta_on) k_.ta = 1024 - (((r_[0][0x24] << 2) | (r_[0][0x25] & 3)) & 1023);
      if ((v & 2) && !k_.tb_on) k_.tb = 256 - r_[0][0x26];
      k_.ta_on = (v & 1) != 0; k_.tb_on = (v & 2) != 0; update_irq(); break;
    }
    case 0x28: {
      int c = v & 3;
      if (c == 0 || c == 3) return;
      if (v & 4) c += 3;
      for (int s = 0; s < 4; s++) {
        const int o = c * 4 + s;
        if (v & (0x10u << s)) { k_.ph[o] = 0; k_.st[o] = 0; k_.fbo[c * 2] = k_.fbo[c * 2 + 1] = 0; }
        else if (k_.st[o] != 4) k_.st[o] = 3;
      }
      return;
    }
    default: break;
  }
  if (a >= 0x30) fm_reg(0, a, v);
}
void Ym2610::wb(int a, std::uint32_t v) {
  if (a < 0x30) {   // ADPCM-A
    if (a == 0x00) {
      for (int c = 0; c < 6; c++) if (v & (1u << c)) {
        if (v & 0x80) k_.a_on[c] = 0;
        else {
          const std::uint8_t* r = r_[1];
          k_.a_on[c] = 1; k_.a_addr[c] = ((r[0x18 + c] << 8) | r[0x10 + c]) * 256; k_.a_end[c] = (((r[0x28 + c] << 8) | r[0x20 + c]) + 1) * 256;
          k_.a_acc[c] = 0; k_.a_idx[c] = 0; k_.a_nib[c] = 0; k_.a_out[c] = 0;
        }
      }
    }
    return;
  }
  fm_reg(1, a, v);
}
void Ym2610::fm_reg(int port, int a, std::uint32_t v) {
  int c = a & 3;
  if (c == 3) return;
  if (port) c += 3;
  const int s = kSlot[(a >> 2) & 3], o = c * 4 + s, g = a & 0xF0;
  if (a < 0xA0) {
    switch (g) {
      case 0x30: k_.dtm[o] = kMul[v & 15]; upd_inc(c); break;
      case 0x40: k_.tl[o] = v & 127; break;
      case 0x50: k_.ks[o] = static_cast<std::uint8_t>(v >> 6); k_.ar[o] = v & 31; upd_inc(c); break;
      case 0x60: k_.dr[o] = v & 31; break;
      case 0x70: k_.sr[o] = v & 31; break;
      case 0x80: k_.sl[o] = (v >> 4) == 15 ? 992 : (v >> 4) * 32; k_.rr[o] = v & 15; break;
      default: break;
    }
    return;
  }
  if ((a & 0xFC) == 0xA4) { k_.fn_hi = v & 0x3F; return; }
  if ((a & 0xFC) == 0xA0) { k_.fn[c] = ((k_.fn_hi & 7) << 8) | v; k_.blk[c] = (k_.fn_hi >> 3) & 7; upd_inc(c); return; }
  if ((a & 0xFC) == 0xB0) { k_.alg[c] = v & 7; k_.fb[c] = (v >> 3) & 7; }
}
void Ym2610::upd_inc(int c) {
  const int fn = k_.fn[c], b = k_.blk[c], kc = (b << 2) | ((fn >> 9) & 3);
  for (int s = 0; s < 4; s++) {
    const int o = c * 4 + s;
    k_.inc[o] = ((fn << b) >> 1) * k_.dtm[o] * (1.0 / 1024) * 1;
    k_.rate4[o] = kc >> (3 - k_.ks[o]);
  }
}
int Ym2610::eg_rate(int o, int R) const { if (R == 0) return 0; const int r = 2 * R + k_.rate4[o]; return r > 63 ? 63 : r; }
void Ym2610::eg_tick(int o) {
  const int st = k_.st[o];
  if (st == 4) return;
  int rate;
  if (st == 0) rate = eg_rate(o, k_.ar[o]); else if (st == 1) rate = eg_rate(o, k_.dr[o]); else if (st == 2) rate = eg_rate(o, k_.sr[o]);
  else rate = std::min(63, 4 * k_.rr[o] + 2 + k_.rate4[o]);
  if (rate == 0) return;
  int inc;
  const int sh = 11 - (rate >> 2);
  if (sh < 0) inc = kEgInc[rate & 3][k_.eg_cnt & 7] * (1 << (-sh));
  else { if (k_.eg_cnt & ((1 << sh) - 1)) return; inc = kEgInc[rate & 3][(k_.eg_cnt >> sh) & 7]; }
  if (!inc) return;
  std::int32_t& att = k_.att[o];
  if (st == 0) {
    if (rate >= 62) att = 0; else att += static_cast<std::int32_t>((static_cast<std::int64_t>(~att) * inc) >> 4);
    if (att <= 0) { att = 0; k_.st[o] = 1; }
  } else if (st == 1) { att += inc; if (att >= k_.sl[o]) { att = std::min<std::int32_t>(att, 1023); k_.st[o] = 2; } }
  else if (st == 2) { att += inc; if (att >= 1023) { att = 1023; k_.st[o] = 4; } }
  else { att += inc; if (att >= 1023) { att = 1023; k_.st[o] = 4; } }
}
double Ym2610::op_out(int o, double pm) const {
  const int att = k_.att[o] + (k_.tl[o] << 3);
  const std::int32_t idx = static_cast<std::int32_t>(static_cast<std::int32_t>(k_.ph[o] * 1024) + static_cast<std::int32_t>(pm));
  return static_cast<double>(T().sin_[idx & 1023]) * static_cast<double>(T().amp[att > 1023 ? 1023 : att]) * 8191;
}

/* ---- uma amostra (a 55.5 kHz) ---- */
void Ym2610::sample() {
  Chip& k = k_;
  if (k.ta_on) { k.ta -= 2; if (k.ta <= 0) { k.ta += 1024 - (((r_[0][0x24] << 2) | (r_[0][0x25] & 3)) & 1023); k.flags |= 1; update_irq(); } }
  if (k.tb_on) { k.tb -= 0.125; if (k.tb <= 0) { k.tb += 256 - r_[0][0x26]; k.flags |= 2; update_irq(); } }
  if (++k.eg_div >= 3) { k.eg_div = 0; k.eg_cnt++; for (int o = 0; o < 24; o++) eg_tick(o); }
  double fm = 0;
  for (int n = 0; n < 4; n++) {
    const int c = n < 2 ? n + 1 : n + 2, b = c * 4;
    double* o = k.o; double* ph = k.ph; const double* inc = k.inc;
    bool any = false;
    for (int s = 0; s < 4; s++) if (k.st[b + s] != 4) { any = true; break; }
    if (!any) continue;
    for (int s = 0; s < 4; s++) ph[b + s] = std::fmod(ph[b + s] + inc[b + s] / 1024 * 1024 / 1024 * 1, 1.0);
    const double fbv = k.fb[c] ? (k.fbo[c * 2] + k.fbo[c * 2 + 1]) / (1 << (10 - k.fb[c])) : 0;
    const double o0 = op_out(b, fbv);
    k.fbo[c * 2 + 1] = k.fbo[c * 2]; k.fbo[c * 2] = o0; o[b] = o0;
    auto m = [](double x) { return x / 2; };
    double out = 0;
    switch (k.alg[c]) {
      case 0: o[b + 1] = op_out(b + 1, m(o0)); o[b + 2] = op_out(b + 2, m(o[b + 1])); out = op_out(b + 3, m(o[b + 2])); break;
      case 1: o[b + 1] = op_out(b + 1, 0); o[b + 2] = op_out(b + 2, m(o0 + o[b + 1])); out = op_out(b + 3, m(o[b + 2])); break;
      case 2: o[b + 1] = op_out(b + 1, 0); o[b + 2] = op_out(b + 2, m(o[b + 1])); out = op_out(b + 3, m(o0 + o[b + 2])); break;
      case 3: o[b + 1] = op_out(b + 1, m(o0)); o[b + 2] = op_out(b + 2, 0); out = op_out(b + 3, m(o[b + 1] + o[b + 2])); break;
      case 4: o[b + 1] = op_out(b + 1, m(o0)); o[b + 3] = op_out(b + 3, m(op_out(b + 2, 0))); out = o[b + 1] + o[b + 3]; break;
      case 5: { const double x1 = op_out(b + 1, m(o0)), x2 = op_out(b + 2, m(o0)), x3 = op_out(b + 3, m(o0)); out = x1 + x2 + x3; break; }
      case 6: { const double x1 = op_out(b + 1, m(o0)), x2 = op_out(b + 2, 0), x3 = op_out(b + 3, 0); out = x1 + x2 + x3; break; }
      default: { const double x1 = op_out(b + 1, 0), x2 = op_out(b + 2, 0), x3 = op_out(b + 3, 0); out = o0 + x1 + x2 + x3; }
    }
    fm += out;
  }
  double mix = fm / 32768 * 0.9;
  const double s1 = ssg() * 0.30;
  const double s2 = adpcm_a() * 0.45;
  const double s3 = adpcm_b() * 0.45;
  mix += s1 + s2 + s3;
  if (wp_ - rp_ >= kBuf - 2) rp_++;
  abuf_[wp_ & kMask] = static_cast<float>(mix); wp_++;
}

/* ---- SSG ---- */
double Ym2610::ssg() {
  Chip& k = k_;
  const std::uint8_t* r = r_[0];
  for (int i = 0; i < 3; i++) {
    k.s_cnt[i] += 2.25;
    const int p = std::max(1, ((r[i * 2 + 1] & 15) << 8) | r[i * 2]);
    while (k.s_cnt[i] >= p) { k.s_cnt[i] -= p; k.s_out[i] ^= 1; }
  }
  k.n_cnt += 2.25 / 2;
  const int np = std::max(1, r[6] & 31);
  while (k.n_cnt >= np) { k.n_cnt -= np; const int b = (k.lfsr ^ (k.lfsr >> 3)) & 1; k.lfsr = (k.lfsr >> 1) | (b << 16); k.n_out = k.lfsr & 1; }
  const int ep = std::max(1, (r[12] << 8) | r[11]);
  k.e_cnt += 0.1406;
  while (k.e_cnt >= ep) { k.e_cnt -= ep; env_step(); }
  double s = 0;
  for (int i = 0; i < 3; i++) {
    const int mx = r[7], tone = (mx >> i) & 1 ? 1 : k.s_out[i], noise = (mx >> (i + 3)) & 1 ? 1 : k.n_out;
    const int vol = (r[8 + i] & 16) ? k.e_vol : (r[8 + i] & 15) * 2 + 1;
    if (tone & noise) s += static_cast<double>(T().ssgv[vol & 31]);
  }
  return s;
}
void Ym2610::env_step() {
  Chip& k = k_;
  const int sh = r_[0][13] & 15;
  if (k.e_hold) return;
  k.e_step++;
  const int cont = sh & 8, alt = sh & 2, hold = sh & 1;
  if (k.e_step < 32) k.e_vol = k.e_dir ? k.e_vol + 1 : k.e_vol - 1;
  if (k.e_vol < 0) k.e_vol = 0;
  if (k.e_vol > 31) k.e_vol = 31;
  if (k.e_step >= 32) {
    k.e_step = 0;
    if (!cont) { k.e_vol = 0; k.e_hold = 1; }
    else if (hold) { if (alt) k.e_vol = k.e_dir ? 0 : 31; k.e_hold = 1; }
    else { if (alt) k.e_dir ^= 1; k.e_vol = k.e_dir ? 0 : 31; }
  }
}

/* ---- ADPCM-A ---- */
double Ym2610::adpcm_a() {
  Chip& k = k_;
  const std::uint8_t* r = r_[1];
  double sum = 0;
  const bool step = ++k.a_div >= 3;
  if (step) k.a_div = 0;
  const int tl = r[1] & 63;
  for (int c = 0; c < 6; c++) {
    if (!k.a_on[c]) continue;
    if (step) {
      const std::int32_t ad = static_cast<std::int32_t>(k.a_addr[c]);
      if (ad >= k.a_end[c] || static_cast<std::size_t>(ad >> 1) >= rom_.size()) { k.a_on[c] = 0; k.a_flags |= 1 << c; continue; }
      const int byte = static_cast<std::size_t>(ad) < rom_.size() ? rom_[ad] : 0;
      const int nib = (k.a_nib[c] == 0) ? (byte >> 4) & 15 : byte & 15;
      int df = (((nib & 7) * 2 + 1) * kStep[k.a_idx[c]]) >> 3;
      if (nib & 8) df = -df;
      k.a_acc[c] = static_cast<std::int32_t>(static_cast<std::uint32_t>(k.a_acc[c] + df) << 20) >> 20;
      k.a_idx[c] += kAdj[nib & 7];
      if (k.a_idx[c] < 0) k.a_idx[c] = 0; else if (k.a_idx[c] > 48) k.a_idx[c] = 48;
      if (k.a_nib[c] == 0) k.a_nib[c] = 1; else { k.a_nib[c] = 0; k.a_addr[c]++; }
      k.a_out[c] = k.a_acc[c];
    }
    const int lv = r[8 + c] & 31;
    sum += k.a_out[c] * std::pow(10.0, -0.75 * ((31 - lv) + (63 - tl)) / 20);
  }
  return sum / 2048 * 0.5;
}

/* ---- ADPCM-B ---- */
double Ym2610::adpcm_b() {
  Chip& k = k_;
  if (!k.b_on) return 0;
  const int dn = (r_[0][0x1A] << 8) | r_[0][0x19];
  k.b_pos += dn / 65536.0;
  while (k.b_pos >= 1) {
    k.b_pos -= 1;
    if (k.b_nib_left == 0) {
      if (k.b_addr >= k.b_end || static_cast<std::size_t>(k.b_addr) >= rom_.size()) {
        if (r_[0][0x10] & 0x10) k.b_addr = ((r_[0][0x13] << 8) | r_[0][0x12]) * 256;
        else { k.b_on = 0; k.b_flag = 1; return 0; }
      }
      k.b_cur = static_cast<std::size_t>(k.b_addr) < rom_.size() ? rom_[k.b_addr] : 0; k.b_addr++; k.b_nib_left = 2;
    }
    const int nib = k.b_nib_left == 2 ? (k.b_cur >> 4) & 15 : k.b_cur & 15;
    k.b_nib_left--;
    int df = (((nib & 7) * 2 + 1) * k.b_delta) >> 3;
    if (nib & 8) df = -df;
    k.b_acc += df;
    if (k.b_acc > 32767) k.b_acc = 32767; else if (k.b_acc < -32768) k.b_acc = -32768;
    k.b_delta = (k.b_delta * kBAdj[nib & 7]) >> 6;
    if (k.b_delta < 127) k.b_delta = 127; else if (k.b_delta > 24576) k.b_delta = 24576;
    k.b_prev = k.b_out; k.b_out = k.b_acc;
  }
  return k.b_out / 32768.0 * (r_[0][0x1B] / 255.0);
}

void Ym2610::state(StateIO& s) {
  s.v(r_); s.v(addr_); s.v(k_);
  if (!s.saving()) rp_ = wp_;
}

}  // namespace emuhub
