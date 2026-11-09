#pragma once
#include <array>
#include <cstddef>
#include <cstdint>

namespace emuhub {
class NesApu {
 public:
  static constexpr std::size_t kAudioSize=32768;
  NesApu();
  void reset();
  void set_sample_rate(unsigned rate);
  void set_volume(float volume);
  std::size_t buffered() const;
  void fill(float* output,std::size_t count);
  std::uint8_t read(std::uint16_t address);
  void write(std::uint16_t address,std::uint8_t value);
  void run(unsigned cpu_cycles);
  bool irq_pending() const { return irq_; }
 private:
  struct Envelope {
    bool enabled=false,halt=false,const_volume=false,env_start=false;
    std::uint8_t volume=0,env_div=0,env_decay=0,length=0;
    void clock_env();
    void clock_length();
  };
  struct Pulse : Envelope {
    explicit Pulse(bool ones=true):ones(ones){}
    bool ones=false,sweep_enable=false,sweep_negate=false,sweep_reload=false;
    std::uint8_t duty=0,sequence=0,sweep_period=0,sweep_shift=0,sweep_div=0;
    unsigned timer=0,period=0;
    void write(unsigned reg,std::uint8_t value);
    void clock_timer();
    void advance(unsigned cycles);
    int target() const;
    void clock_sweep();
    unsigned output() const;
  };
  struct Triangle {
    bool enabled=false,control=false,linear_flag=false;
    std::uint8_t linear_reload=0,linear=0,length=0,sequence=0;
    unsigned timer=0,period=0;
    void write(unsigned reg,std::uint8_t value);
    void clock_timer();
    void advance(unsigned cycles);
    void clock_linear();
    void clock_length();
    unsigned output() const;
  };
  struct Noise : Envelope {
    bool mode=false;
    unsigned period=4,timer=0;
    std::uint16_t shift=1;
    void write(unsigned reg,std::uint8_t value);
    void clock_timer();
    void advance(unsigned cycles);
    unsigned output() const;
  };
  Pulse pulse1_{true},pulse2_{false};
  Triangle triangle_{};
  Noise noise_{};
  std::array<float,kAudioSize> ring_{};
  std::uint64_t read_pos_=0,write_pos_=0;
  float last_=0,px_=0,py_=0,volume_=1.0f,ratio_=1789773.0f/44100.0f;
  unsigned sample_rate_=44100,frame_counter_=0,cycles_=0,nacc_=0;
  bool mode5_=false,inhibit_=false,irq_=false;
  float sum_=0,phase_=0;
  void quarter_frame();
  void half_frame();
  void push_sample(float sample);
  float mix() const;
};
} // namespace emuhub
