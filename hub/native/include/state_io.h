#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <type_traits>
#include <vector>

namespace emuhub {

/* Serialização de estado (salvar/carregar/rebobinar). O mesmo código de "campos" serve para os dois sentidos:
 * ao salvar os bytes são anexados; ao carregar são lidos na mesma ordem. Se faltar dado ou um vetor tiver
 * tamanho diferente (ROM diferente), ok() vira falso. */
class StateIO {
 public:
  explicit StateIO(std::vector<std::uint8_t>* out) : out_(out), saving_(true) {}
  StateIO(const std::uint8_t* in, std::size_t n) : in_(in), n_(n), saving_(false) {}
  bool saving() const { return saving_; }
  bool ok() const { return ok_; }
  std::size_t position() const { return saving_ ? out_->size() : pos_; }

  void raw(void* p, std::size_t n) {
    if (!ok_) return;
    if (saving_) { const auto* b = static_cast<const std::uint8_t*>(p); out_->insert(out_->end(), b, b + n); return; }
    if (pos_ + n > n_) { ok_ = false; return; }
    if (n) std::memcpy(p, in_ + pos_, n);
    pos_ += n;
  }
  template <class T> void v(T& x) { static_assert(std::is_trivially_copyable<T>::value, "estado precisa ser POD"); raw(&x, sizeof(T)); }
  template <class T, std::size_t N> void v(std::array<T, N>& a) { static_assert(std::is_trivially_copyable<T>::value, ""); raw(a.data(), N * sizeof(T)); }
  template <class T, std::size_t N> void v(T (&a)[N]) { static_assert(std::is_trivially_copyable<T>::value, ""); raw(a, N * sizeof(T)); }
  template <class T> void vec(std::vector<T>& a) {
    static_assert(std::is_trivially_copyable<T>::value, "");
    std::uint32_t n = static_cast<std::uint32_t>(a.size());
    v(n);
    if (!saving_ && n != a.size()) { ok_ = false; return; }
    raw(a.data(), a.size() * sizeof(T));
  }

 private:
  std::vector<std::uint8_t>* out_ = nullptr;
  const std::uint8_t* in_ = nullptr;
  std::size_t n_ = 0, pos_ = 0;
  bool saving_ = false, ok_ = true;
};

}  // namespace emuhub
