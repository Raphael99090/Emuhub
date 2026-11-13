#include "nes_apu.h"
#include <algorithm>
#include <cmath>

namespace emuhub {
namespace {
constexpr std::array<std::uint8_t,32> kLength={10,254,20,2,40,4,80,6,160,8,60,10,14,12,26,14,12,16,24,18,48,20,96,22,192,24,72,26,16,28,32,30};
constexpr std::array<std::array<std::uint8_t,8>,4> kDuty={{
 {{0,1,0,0,0,0,0,0}},{{0,1,1,0,0,0,0,0}},
 {{0,1,1,1,1,0,0,0}},{{1,0,0,1,1,1,1,1}}
}};
constexpr std::array<unsigned,16> kNoisePeriod={4,8,16,32,64,96,128,160,202,254,380,508,762,1016,2034,4068};
const std::array<float,31> kPulseTable=[](){std::array<float,31> a{};for(unsigned i=1;i<31;++i)a[i]=95.52f/(8128.0f/float(i)+100.0f);return a;}();
const std::array<float,203> kTndTable=[](){std::array<float,203> a{};for(unsigned i=1;i<203;++i)a[i]=163.67f/(24329.0f/float(i)+100.0f);return a;}();
}
void NesApu::Envelope::clock_env(){
 if(env_start){env_start=false;env_decay=15;env_div=volume;}
 else if(env_div==0){env_div=volume;if(env_decay>0)--env_decay;else if(halt)env_decay=15;}
 else --env_div;
}
void NesApu::Envelope::clock_length(){if(!halt&&length>0)--length;}
void NesApu::Pulse::write(unsigned r,std::uint8_t v){
 switch(r){
  case 0:duty=v>>6;halt=(v&0x20)!=0;const_volume=(v&0x10)!=0;volume=v&15;break;
  case 1:sweep_enable=(v&0x80)!=0;sweep_period=(v>>4)&7;sweep_negate=(v&8)!=0;sweep_shift=v&7;sweep_reload=true;break;
  case 2:period=(period&0x700)|v;break;
  case 3:period=(period&0xff)|((v&7)<<8);if(enabled)length=kLength[v>>3];sequence=0;env_start=true;break;
 }
}
void NesApu::Pulse::clock_timer(){if(timer==0){timer=period;sequence=(sequence+1)&7;}else --timer;}
void NesApu::Pulse::advance(unsigned k){
 while(k>0){if(timer>=k){timer-=k;return;}k-=timer+1;timer=period;sequence=(sequence+1)&7;}
}
int NesApu::Pulse::target()const{
 const int delta=int(period>>sweep_shift);
 return sweep_negate?int(period)-delta-(ones?1:0):int(period)+delta;
}
void NesApu::Pulse::clock_sweep(){
 const int target_period=target();const bool mute=period<8||target_period>0x7ff;
 if(sweep_div==0&&sweep_enable&&sweep_shift>0&&!mute)period=static_cast<unsigned>(target_period);
 if(sweep_div==0||sweep_reload){sweep_div=sweep_period;sweep_reload=false;}else --sweep_div;
}
unsigned NesApu::Pulse::output()const{
 if(!enabled||length==0||kDuty[duty][sequence]==0||period<8||target()>0x7ff)return 0;
 return const_volume?volume:env_decay;
}
void NesApu::Triangle::write(unsigned r,std::uint8_t v){
 switch(r){
  case 0:control=(v&0x80)!=0;linear_reload=v&0x7f;break;
  case 2:period=(period&0x700)|v;break;
  case 3:period=(period&0xff)|((v&7)<<8);if(enabled)length=kLength[v>>3];linear_flag=true;break;
 }
}
void NesApu::Triangle::clock_timer(){if(timer==0){timer=period;if(length>0&&linear>0)sequence=(sequence+1)&31;}else --timer;}
void NesApu::Triangle::advance(unsigned k){
 while(k>0){if(timer>=k){timer-=k;return;}k-=timer+1;timer=period;if(length>0&&linear>0)sequence=(sequence+1)&31;}
}
void NesApu::Triangle::clock_linear(){if(linear_flag)linear=linear_reload;else if(linear>0)--linear;if(!control)linear_flag=false;}
void NesApu::Triangle::clock_length(){if(!control&&length>0)--length;}
unsigned NesApu::Triangle::output()const{if(period<2)return 7;return sequence<16?15-sequence:sequence-16;}
void NesApu::Noise::write(unsigned r,std::uint8_t v){
 switch(r){
  case 0:halt=(v&0x20)!=0;const_volume=(v&0x10)!=0;volume=v&15;break;
  case 2:mode=(v&0x80)!=0;period=kNoisePeriod[v&15];break;
  case 3:if(enabled)length=kLength[v>>3];env_start=true;break;
 }
}
void NesApu::Noise::clock_timer(){
 if(timer==0){timer=period;const unsigned fb=(shift&1)^((shift>>(mode?6:1))&1);shift=std::uint16_t((shift>>1)|(fb<<14));}else --timer;
}
void NesApu::Noise::advance(unsigned k){
 while(k>0){if(timer>=k){timer-=k;return;}k-=timer+1;timer=period;const unsigned fb=(shift&1)^((shift>>(mode?6:1))&1);shift=std::uint16_t((shift>>1)|(fb<<14));}
}
unsigned NesApu::Noise::output()const{if(!enabled||length==0||(shift&1))return 0;return const_volume?volume:env_decay;}

NesApu::NesApu(){set_sample_rate(44100);reset();}
void NesApu::set_sample_rate(unsigned rate){sample_rate_=std::max(8000u,rate);ratio_=1789773.0f/float(sample_rate_);}
void NesApu::set_volume(float volume){volume_=std::max(0.0f,std::min(1.0f,volume));}
void NesApu::reset(){
 pulse1_=Pulse(true);pulse2_=Pulse(false);triangle_=Triangle{};noise_=Noise{};
 read_pos_=write_pos_=0;last_=px_=py_=0;frame_counter_=cycles_=nacc_=0;
 mode5_=inhibit_=irq_=false;sum_=phase_=0;ring_.fill(0);
}
std::size_t NesApu::buffered()const{return static_cast<std::size_t>(write_pos_-read_pos_);}
void NesApu::push_sample(float sample){
 const float y=sample-px_+0.996f*py_;px_=sample;py_=y;
 if(write_pos_-read_pos_>=kAudioSize)++read_pos_;
 ring_[write_pos_&(kAudioSize-1)]=y*0.8f*volume_;++write_pos_;
}
void NesApu::fill(float* out,std::size_t count){
 if(!out)return;
 for(std::size_t i=0;i<count;++i){if(read_pos_<write_pos_){last_=ring_[read_pos_&(kAudioSize-1)];++read_pos_;}else last_*=0.995f;out[i]=last_;}
}
void NesApu::quarter_frame(){pulse1_.clock_env();pulse2_.clock_env();noise_.clock_env();triangle_.clock_linear();}
void NesApu::half_frame(){pulse1_.clock_length();pulse2_.clock_length();triangle_.clock_length();noise_.clock_length();pulse1_.clock_sweep();pulse2_.clock_sweep();}
std::uint8_t NesApu::read(std::uint16_t a){
 if(a!=0x4015)return 0;
 const auto value=std::uint8_t((pulse1_.length>0?1:0)|(pulse2_.length>0?2:0)|(triangle_.length>0?4:0)|(noise_.length>0?8:0)|(irq_?0x40:0));
 irq_=false;return value;
}
void NesApu::write(std::uint16_t a,std::uint8_t v){
 if(a>=0x4000&&a<=0x4003)pulse1_.write(a&3,v);
 else if(a>=0x4004&&a<=0x4007)pulse2_.write(a&3,v);
 else if(a>=0x4008&&a<=0x400b)triangle_.write(a&3,v);
 else if(a>=0x400c&&a<=0x400f)noise_.write(a&3,v);
 else if(a==0x4015){
  pulse1_.enabled=(v&1)!=0;if(!pulse1_.enabled)pulse1_.length=0;
  pulse2_.enabled=(v&2)!=0;if(!pulse2_.enabled)pulse2_.length=0;
  triangle_.enabled=(v&4)!=0;if(!triangle_.enabled)triangle_.length=0;
  noise_.enabled=(v&8)!=0;if(!noise_.enabled)noise_.length=0;
 }else if(a==0x4017){
  mode5_=(v&0x80)!=0;inhibit_=(v&0x40)!=0;if(inhibit_)irq_=false;frame_counter_=0;
  if(mode5_){quarter_frame();half_frame();}
 }
}
float NesApu::mix()const{return kPulseTable[pulse1_.output()+pulse2_.output()]+kTndTable[3*triangle_.output()+2*noise_.output()];}
void NesApu::run(unsigned n){
 while(n>0){
  if((cycles_&3)==0&&n>=4){
   const unsigned last=mode5_?37281:29829,lim=mode5_?37282:29830;
   const unsigned next=frame_counter_<7457?7457:frame_counter_<14913?14913:frame_counter_<22371?22371:frame_counter_<last?last:lim;
   if(next-frame_counter_>4){
    frame_counter_+=4;cycles_+=4;n-=4;
    triangle_.advance(4);noise_.advance(4);pulse1_.advance(2);pulse2_.advance(2);
    sum_+=mix();++nacc_;phase_+=4;
    if(phase_>=ratio_){phase_-=ratio_;push_sample(sum_/float(nacc_));sum_=0;nacc_=0;}
    continue;
   }
  }
  const unsigned f=++frame_counter_;
  if(f==7457)quarter_frame();
  else if(f==14913){quarter_frame();half_frame();}
  else if(f==22371)quarter_frame();
  else if(mode5_){if(f==37281){quarter_frame();half_frame();}}
  else if(f==29829){quarter_frame();half_frame();if(!inhibit_)irq_=true;}
  if(f>=(mode5_?37282:29830))frame_counter_=0;
  triangle_.clock_timer();noise_.clock_timer();++cycles_;
  if(cycles_&1){pulse1_.clock_timer();pulse2_.clock_timer();}
  if((cycles_&3)==0){sum_+=mix();++nacc_;phase_+=4;if(phase_>=ratio_){phase_-=ratio_;push_sample(sum_/float(nacc_));sum_=0;nacc_=0;}}
  --n;
 }
}

void NesApu::state(StateIO& s) {
  s.v(pulse1_); s.v(pulse2_); s.v(triangle_); s.v(noise_);
  s.v(last_); s.v(px_); s.v(py_); s.v(frame_counter_); s.v(cycles_); s.v(nacc_);
  s.v(mode5_); s.v(inhibit_); s.v(irq_); s.v(sum_); s.v(phase_);
  if (!s.saving()) { read_pos_ = write_pos_; }
}

} // namespace emuhub
