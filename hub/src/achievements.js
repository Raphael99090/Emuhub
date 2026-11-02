/* Motor de conquistas: cada jogo tem uma lista de conquistas, cada uma com uma condição sobre a RAM do console.
   Sintaxe da condição (várias com && ; alternativas com ||):
     m8:0x0075 >= 9          lê 1 byte (m16, m24, m32 = little-endian)
     prev(m8:0x75) < m8:0x75  valor do quadro anterior (para detectar mudança)
     bit(m8:0x75, 3) == 1    um bit do byte
     p8:0x03005008+0x234 >= 1  lê o ponteiro em 0x03005008 e o byte no endereço apontado + 0x234
     pop(0x0300500C+0x28, 19) >= 10  conta bits ligados em 19 bytes
     m8:0x75 == 3 for 120    precisa valer por 120 quadros seguidos
   O motor não conhece jogo nenhum: as conquistas vêm das definições (internas, importadas ou criadas pelo usuário). */
const Ach = (() => {
  const SZ = { m8: 1, m16: 2, m24: 3, m32: 4 };
  const OPS = { '==': (a, b) => a === b, '!=': (a, b) => a !== b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b };

  /* operando -> função (peek, prevCache) => número */
  function operand(t) {
    t = t.trim(); let m;
    if (/^(0x[0-9a-f]+|\d+)$/i.test(t)) { const n = Number(t); return () => n; }
    if ((m = /^(m8|m16|m24|m32):\s*(0x[0-9a-f]+|\d+)$/i.exec(t))) { const sz = SZ[m[1].toLowerCase()], ad = Number(m[2]); return c => c.read(ad, sz); }
    if ((m = /^prev\((.+)\)$/i.exec(t))) { const inner = operand(m[1]), key = m[1].trim(); return c => (c.prev.has(key) ? c.prev.get(key) : inner(c)); }
    if ((m = /^(p8|p16|p32):\s*(0x[0-9a-f]+|\d+)\s*\+\s*(0x[0-9a-f]+|\d+)$/i.exec(t))) { // lê um ponteiro (32 bits) e, no endereço apontado + deslocamento, 1/2/4 bytes
      const sz = { p8: 1, p16: 2, p32: 4 }[m[1].toLowerCase()], pa = Number(m[2]), off = Number(m[3]);
      return c => c.read((c.read(pa, 4) + off) >>> 0, sz);
    }
    if ((m = /^pop\(\s*(0x[0-9a-f]+|\d+)\s*\+\s*(0x[0-9a-f]+|\d+)\s*,\s*(\d+)\s*\)$/i.exec(t))) { // quantos bits ligados em N bytes (ex.: Pokédex)
      const pa = Number(m[1]), off = Number(m[2]), n = Math.min(Number(m[3]), 256);
      return c => { const b = (c.read(pa, 4) + off) >>> 0; let k = 0; for (let i = 0; i < n; i++) { let v = c.read(b + i, 1); while (v) { k += v & 1; v >>= 1; } } return k; };
    }
    if (/^bit\(.+,\s*\d+\s*\)$/i.test(t)) { const i = t.lastIndexOf(','), inner = operand(t.slice(4, i)), b = Number(t.slice(i + 1, -1)); return c => Math.floor(inner(c) / Math.pow(2, b)) % 2; }
    throw new Error('Não entendi "' + t + '". Use m8:0x0075, p8:PONTEIRO+DESLOC, pop(PONTEIRO+DESLOC,N), prev(...), bit(...,3) ou um número.');
  }
  /* uma comparação: A op B [for N] */
  function cmp(txt) {
    const m = /^(.*?)\s*(==|!=|>=|<=|>|<)\s*(.*?)(?:\s+for\s+(\d+))?$/i.exec(txt.trim());
    if (!m) throw new Error('Condição inválida: "' + txt.trim() + '". Exemplo: m8:0x0075 >= 9');
    const a = operand(m[1]), b = operand(m[3]), op = OPS[m[2]], hold = m[4] ? Math.min(Number(m[4]), 36000) : 0;
    const keys = []; for (const s of [m[1], m[3]]) { const k = /^prev\((.+)\)$/i.exec(s.trim()); if (k) keys.push(k[1].trim()); }
    return { a, b, op, hold, keys, run: 0 };
  }
  /* texto -> grupos (OU) de comparações (E) */
  function parse(text) {
    const src = String(text || '').trim(); if (!src) throw new Error('Escreva a condição.');
    return src.split('||').map(g => g.split('&&').map(cmp));
  }
  class Engine {
    constructor() { this.core = null; this.defs = []; this.active = []; this.got = {}; this.onUnlock = null; this.stats = { secs: 0, frames: 0 }; this.ctx = { prev: new Map(), cur: new Map(), read: (a, n) => this.read(a, n) }; }
    read(a, n) { const p = this.core.peek; let v = 0; for (let i = 0; i < n; i++) v += p.call(this.core, a + i) * Math.pow(256, i); return v; }
    /* defs: [{id,title,desc,pts,cond}] ; got: {id: timestamp} */
    setup(core, defs, got) {
      this.core = core; this.got = got || {}; this.defs = []; this.active = []; this.bad = []; this.prevKeys = new Set();
      this.ctx.prev = new Map(); this.ctx.cur = new Map();
      for (const d of defs) {
        let rule = null;
        if (d.cond) { try { rule = parse(d.cond); } catch (e) { this.bad.push({ d, err: e.message }); } }
        this.defs.push(d);
        if (rule && !this.got[d.id]) { this.active.push({ d, rule }); for (const g of rule) for (const c of g) for (const k of c.keys) this.prevKeys.add(k); }
      }
    }
    /* chamado a cada quadro de jogo */
    tick() {
      if (!this.core || !this.core.peek || !this.active.length) return;
      const ctx = this.ctx;
      ctx.prev = ctx.cur; ctx.cur = new Map();
      for (const k of this.prevKeys) ctx.cur.set(k, operand(k)(ctx));
      for (let i = this.active.length - 1; i >= 0; i--) {
        const a = this.active[i]; let hit = false;
        for (const g of a.rule) {
          let all = true;
          for (const c of g) {
            const ok = c.op(c.a(ctx), c.b(ctx));
            c.run = ok ? c.run + 1 : 0;
            if (!ok || c.run <= c.hold) all = false;
          }
          if (all) { hit = true; break; }
        }
        if (hit) { this.unlock(a.d); this.active.splice(i, 1); }
      }
    }
    unlock(d) { if (this.got[d.id]) return; this.got[d.id] = Date.now(); if (this.onUnlock) this.onUnlock(d); }
    /* conquistas que não dependem de memória (tempo, estados...) */
    award(id) { const d = this.defs.find(x => x.id === id); if (d && !this.got[id]) this.unlock(d); }
  }

  /* ---- busca de endereços (como o "cheat search"): ajuda a achar o endereço para criar a condição ---- */
  const RANGES = {
    nes: [[0, 0x800]], snes: [[0x7E0000, 0x7E0000 + 0x20000]], gb: [[0xC000, 0xE000], [0xFF80, 0xFFFF]], gbc: [[0xC000, 0xE000], [0xFF80, 0xFFFF]],
    sms: [[0xC000, 0xE000]], gg: [[0xC000, 0xE000]], gba: [[0x02000000, 0x02040000], [0x03000000, 0x03008000]],
  };
  class Search {
    constructor(core, con) { this.core = core; this.ranges = RANGES[con] || RANGES.nes; this.addrs = null; this.vals = null; }
    get count() { return this.addrs ? this.addrs.length : 0; }
    /* modo: 'eq' valor exato | 'any' só tira a primeira foto | 'ch' mudou | 'same' igual | 'up' subiu | 'down' desceu */
    step(mode, val) {
      const p = this.core.peek, c = this.core, na = [], nv = [];
      if (!this.addrs) {
        for (const [s, e] of this.ranges) for (let a = s; a < e; a++) { const v = p.call(c, a); if (mode === 'any' || v === val) { na.push(a); nv.push(v); } }
      } else {
        for (let i = 0; i < this.addrs.length; i++) {
          const a = this.addrs[i], v = p.call(c, a), o = this.vals[i];
          const ok = mode === 'eq' ? v === val : mode === 'ch' ? v !== o : mode === 'same' ? v === o : mode === 'up' ? v > o : mode === 'down' ? v < o : true;
          if (ok) { na.push(a); nv.push(v); }
        }
      }
      this.addrs = na; this.vals = nv; return na.length;
    }
    list(n) { const o = []; for (let i = 0; i < Math.min(n || 12, this.count); i++) o.push({ addr: this.addrs[i], val: this.vals[i] }); return o; }
  }

  /* conquistas automáticas, valem para qualquer jogo */
  const GENERIC = [
    { id: 'g_first', title: 'Primeira partida', desc: 'Abra o jogo e jogue por 1 minuto.', pts: 5, auto: 'min1' },
    { id: 'g_30', title: 'Esquentando', desc: 'Jogue 30 minutos neste jogo.', pts: 10, auto: 'min30' },
    { id: 'g_60', title: 'Mais uma horinha', desc: 'Jogue 1 hora neste jogo.', pts: 15, auto: 'min60' },
    { id: 'g_600', title: 'Veterano', desc: 'Jogue 10 horas neste jogo.', pts: 50, auto: 'min600' },
    { id: 'g_state', title: 'Prevenido', desc: 'Salve um estado (slot) pela primeira vez.', pts: 5, auto: 'state' },
    { id: 'g_load', title: 'De volta ao passado', desc: 'Carregue um estado salvo.', pts: 5, auto: 'load' },
    { id: 'g_rew', title: 'Quase!', desc: 'Use o rebobinar para desfazer um erro.', pts: 5, auto: 'rewind' },
    { id: 'g_turbo', title: 'Pressa', desc: 'Jogue em velocidade acima de 1x.', pts: 5, auto: 'speed' },
    { id: 'g_cheat', title: 'Trapaceiro', desc: 'Ligue um cheat.', pts: 5, auto: 'cheat' },
    { id: 'g_5', title: 'Fiel', desc: 'Abra este jogo em 5 dias diferentes.', pts: 20, auto: 'days5' },
  ];
  return { parse, Engine, Search, GENERIC, RANGES };
})();
if (typeof module !== 'undefined') module.exports = Ach;
