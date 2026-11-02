/* Pacotes prontos de conquistas. Cada pacote vale para jogos reconhecidos pelo cabeçalho da ROM.
   Os endereços vêm dos mapas de RAM públicos (decomp pokefirered) e ainda precisam ser confirmados jogando. */
const ACH_PACKS = (() => {
  const B1 = 0x03005008, B2 = 0x0300500C, hx = n => '0x' + n.toString(16).toUpperCase();
  const sb1 = (off, sz) => 'p' + (sz || 8) + ':' + hx(B1) + '+' + hx(off);
  const sb2 = (off, sz) => 'p' + (sz || 8) + ':' + hx(B2) + '+' + hx(off);
  const flag = n => 'bit(' + sb1(0xEE0 + (n >> 3)) + ',' + (n & 7) + ') == 1';
  const lvl = i => sb1(0x238 + 100 * i + 0x54);
  const defs = [];
  const add = (title, desc, pts, cond) => defs.push({ title, desc, pts, cond });

  // insígnias
  [['Pedra', 'Brock', 'Pewter'], ['Cascata', 'Misty', 'Cerulean'], ['Trovão', 'Lt. Surge', 'Vermilion'], ['Arco-íris', 'Erika', 'Celadon'],
   ['Alma', 'Koga', 'Fuchsia'], ['Pântano', 'Sabrina', 'Saffron'], ['Vulcão', 'Blaine', 'Cinnabar'], ['Terra', 'Giovanni', 'Viridian']]
    .forEach(([ins, lider, cid], i) => add('Insígnia ' + ins, 'Vença ' + lider + ' no Ginásio de ' + cid + '.', i < 7 ? 15 : 25, flag(0x820 + i)));
  add('Colecionador de insígnias', 'Conquiste as 8 insígnias de Kanto.', 50, sb1(0xEE0 + (0x820 >> 3)) + ' == 255');
  add('Campeão da Liga', 'Vença a Elite dos Quatro e entre no Hall da Fama.', 100, flag(0x82C));

  // Pokédex (bits dos Pokémon capturados / vistos, 19 bytes = os 151 de Kanto)
  [[1, 5], [10, 10], [25, 15], [50, 20], [75, 25], [100, 30], [125, 40], [150, 75], [151, 100]]
    .forEach(([n, p]) => add(n === 151 ? 'Pokédex de Kanto completa' : n + ' Pokémon capturados', n === 151 ? 'Capture os 151 Pokémon de Kanto (com troca).' : 'Tenha ' + n + ' Pokémon registrados como capturados.', p, 'pop(' + hx(B2) + '+0x28, 19) >= ' + n));
  [50, 100, 150].forEach(n => add(n + ' Pokémon vistos', 'Veja ' + n + ' espécies diferentes.', n / 5, 'pop(' + hx(B2) + '+0x59, 19) >= ' + n));

  // time
  add('Primeiro parceiro', 'Receba o seu primeiro Pokémon.', 5, sb1(0x234) + ' >= 1');
  add('Time cheio', 'Tenha 6 Pokémon no time.', 10, sb1(0x234) + ' == 6');
  [[20, 5], [30, 10], [40, 15], [50, 20], [70, 30], [100, 50]].forEach(([n, p]) =>
    add('Nível ' + n, 'Um Pokémon do time chega ao nível ' + n + '.', p, [0, 1, 2, 3, 4, 5].map(i => lvl(i) + ' >= ' + n + (n === 100 ? ' && ' + lvl(i) + ' <= 100' : '')).join(' || ')));
  [[30, 15], [50, 30], [70, 50]].forEach(([n, p]) =>
    add('Time nível ' + n, 'Os 6 Pokémon do time com nível ' + n + ' ou mais.', p, sb1(0x234) + ' == 6 && ' + [0, 1, 2, 3, 4, 5].map(i => lvl(i) + ' >= ' + n).join(' && ')));

  // cidades (grupo 3 = Kanto); precisa ficar na cidade 1 segundo para valer
  [['Pallet Town', 0], ['Viridian City', 1], ['Pewter City', 2], ['Cerulean City', 3], ['Lavender Town', 4], ['Vermilion City', 5], ['Celadon City', 6],
   ['Fuchsia City', 7], ['Cinnabar Island', 8], ['Indigo Plateau', 9], ['Saffron City', 10]]
    .forEach(([nome, n]) => add('Visitou ' + nome, 'Chegue em ' + nome + '.', n === 0 ? 2 : 5, sb1(0x04) + ' == 3 && ' + sb1(0x05) + ' == ' + n + ' for 60'));

  // tempo de jogo
  [[5, 10], [20, 20], [50, 30], [100, 50]].forEach(([h, p]) => add(h + ' horas de aventura', 'Jogue ' + h + ' horas no total (contador do jogo).', p, sb2(0x0E, 16) + ' >= ' + h));

  const make = code => defs.map((d, i) => Object.assign({ id: 'p_' + code + '_' + i }, d));
  return {
    gba: { BPRE: 'FireRed', BPGE: 'LeafGreen' },
    for(con, u8) {
      if (con !== 'gba' || !u8 || u8.length < 0xB0) return [];
      const code = String.fromCharCode(u8[0xAC], u8[0xAD], u8[0xAE], u8[0xAF]);
      return this.gba[code] ? make(code) : [];
    },
  };
})();
