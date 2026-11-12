#!/bin/sh
# Compara o núcleo C++ com o JavaScript em programas aleatórios (registradores, ciclos, imagem).
# Uso: sh hub/native/tests/parity/run.sh   (precisa de g++ e node)
set -e
D=$(cd "$(dirname "$0")" && pwd); N=$D/../..; T=$(mktemp -d)
g++ -std=c++17 -O2 -I"$N/include" "$D/snes_cpu.cpp" "$N/src/snes_cpu.cpp" -o "$T/snes"
g++ -std=c++17 -O2 -I"$N/include" "$D/gb.cpp" "$N/src/gb_machine.cpp" -o "$T/gb"
g++ -std=c++17 -O2 -I"$N/include" "$D/snes_system.cpp" "$N/src/snes_system.cpp" "$N/src/snes_cpu.cpp" -o "$T/sys"
bad=0
for s in 1 2 3 4 5 6 7 8 9 10; do
  [ "$(node "$D/snes_cpu.js" $s 30000)" = "$("$T/snes" $s 30000)" ] || { echo "SNES CPU difere (semente $s)"; bad=1; }
  [ "$(node "$D/gb.js" $s 3)" = "$("$T/gb" $s 3)" ] || { echo "GB difere (semente $s)"; bad=1; }
  for h in 0 1; do [ "$(node "$D/snes_system.js" $s 8 $h)" = "$("$T/sys" $s 8 $h)" ] || { echo "SNES sistema difere (semente $s, hirom=$h)"; bad=1; }; done
done
rm -rf "$T"; [ $bad = 0 ] && echo "paridade ok"; exit $bad
