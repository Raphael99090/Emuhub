#pragma once
#include <cstddef>
#include <cstdint>
#include <vector>

namespace emuhub {
enum class CartridgeError : int {
  Ok = 0,
  InvalidArgument = -1,
  InvalidHeader = -2,
  UnsupportedFormat = -3,
  TruncatedRom = -4,
  InvalidPrgSize = -5,
  UnsupportedMapper = -6,
  InvalidMapperLayout = -7
};

class NesCartridge {
 public:
  CartridgeError load(const std::uint8_t* data, std::size_t size);
  void reset();

  bool loaded() const { return loaded_; }
  std::uint8_t mapper() const { return mapper_; }
  std::size_t prg_size() const { return prg_.size(); }
  std::size_t chr_rom_size() const { return chr_is_ram_ ? 0 : chr_.size(); }
  std::size_t chr_memory_size() const { return chr_.size(); }
  bool chr_is_ram() const { return chr_is_ram_; }
  bool has_battery() const { return battery_; }
  bool has_trainer() const { return trainer_present_; }
  std::uint8_t mirroring() const { return mirroring_; }

  std::uint8_t cpu_read(std::uint16_t address) const;
  void cpu_write(std::uint16_t address, std::uint8_t value);
  std::uint8_t ppu_read(std::uint16_t address) const;
  void ppu_write(std::uint16_t address, std::uint8_t value);

 private:
  bool loaded_ = false;
  std::uint8_t mapper_ = 0;
  std::uint8_t mirroring_ = 0; // 0 horizontal, 1 vertical, 2 four-screen
  bool battery_ = false;
  bool trainer_present_ = false;
  bool chr_is_ram_ = false;
  std::vector<std::uint8_t> prg_;
  std::vector<std::uint8_t> chr_;
  std::vector<std::uint8_t> prg_ram_;
  std::uint8_t uxrom_bank_ = 0;
};
} // namespace emuhub
