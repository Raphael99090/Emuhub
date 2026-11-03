/* Cliente da RetroAchievements (só modo casual): hash da ROM, API, e avaliador das regras das conquistas (formato "MemAddr").
   Escrito a partir da documentação e do código de referência rcheevos. Não suporta: números decimais (float), "Remember/Recall",
   líderes e Rich Presence. Conquistas com esses recursos são ignoradas e aparecem como "não suportadas". */
const RA = (() => {
  /* ---------- MD5 (a Web Crypto não tem MD5) ---------- */
  function md5(bytes) {
    if (typeof bytes === 'string') bytes = new TextEncoder().encode(bytes);
    const K = new Int32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    const n = bytes.length, total = (((n + 8) >> 6) + 1) << 6, buf = new Uint8Array(total);
    buf.set(bytes); buf[n] = 0x80;
    const dv = new DataView(buf.buffer); dv.setUint32(total - 8, (n << 3) >>> 0, true); dv.setUint32(total - 4, Math.floor(n / 536870912), true);
    let a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0;
    const M = new Int32Array(16);
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) M[i] = dv.getInt32(o + i * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
        else { F = C ^ (B | ~D); g = (7 * i) & 15; }
        F = (F + A + K[i] + M[g]) | 0; A = D; D = C; C = B;
        const s = S[(i >> 4) * 4 + (i & 3)]; B = (B + ((F << s) | (F >>> (32 - s)))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    const out = new Uint8Array(16), ov = new DataView(out.buffer);
    ov.setInt32(0, a0, true); ov.setInt32(4, b0, true); ov.setInt32(8, c0, true); ov.setInt32(12, d0, true);
    return Array.from(out, x => x.toString(16).padStart(2, '0')).join('');
  }

  /* ---------- identificação da ROM: mesmo método do rcheevos ---------- */
  const CONSOLE_ID = { snes: 3, gb: 4, gba: 5, gbc: 6, nes: 7, sms: 11, gg: 15 };
  function hashRom(con, u8) {
    let off = 0;
    if (con === 'nes') { if (u8.length > 16 && u8[0] === 0x4E && u8[1] === 0x45 && u8[2] === 0x53 && u8[3] === 0x1A) off = 16; }
    else if (con === 'snes') { if (u8.length - Math.floor(u8.length / 0x2000) * 0x2000 === 512) off = 512; }
    return md5(off ? u8.subarray(off) : u8);
  }

  /* ---------- memória: endereços da RetroAchievements -> memória real de cada núcleo ---------- */
  function makeReader(core, con) {
    const p = a => core.peek(a);
    switch (con) {
      case 'nes': return a => (a < 0x2000 ? p(a & 0x7FF) : a >= 0x6000 && a < 0x8000 ? p(a) : 0);
      case 'snes': return a => (a < 0x20000 ? p(0x7E0000 + a) : (a >= 0x20000 && a < 0xA0000 && core.snes && core.snes.sram && (a - 0x20000) < core.snes.sram.length) ? core.snes.sram[a - 0x20000] : 0);
      case 'gb': case 'gbc': return a => (a >= 0xE000 && a < 0xFE00 ? p(a - 0x2000) : a < 0x10000 ? p(a) : 0);
      case 'gba': return a => (a < 0x8000 ? p(0x03000000 + a) : a < 0x48000 ? p(0x02000000 + a - 0x8000) : 0);
      case 'sms': case 'gg': return a => (a < 0x2000 ? p(0xC000 + a) : 0);
      default: return () => 0;
    }
  }

  /* ---------- análise das regras ---------- */
  class Unsupported extends Error {}
  const SIZES = { H: ['u', 1], ' ': ['u', 2], W: ['u', 3], X: ['u', 4], M: ['b', 0], N: ['b', 1], O: ['b', 2], P: ['b', 3], Q: ['b', 4], R: ['b', 5], S: ['b', 6], T: ['b', 7], L: ['lo', 1], U: ['hi', 1], K: ['cnt', 1], I: ['be', 2], J: ['be', 3], G: ['be', 4] };
  const hexv = c => /[0-9a-fA-F]/.test(c);

  function parseOperand(s, i) {
    const c = s[i], o = { kind: 'const', num: 0, view: 'addr', f: -1, cur: 0, prev: 0, prior: 0, has: false };
    if (c === 'h' || c === 'H') { let j = i + 1; while (j < s.length && hexv(s[j])) j++; if (j === i + 1) throw new Error('constante hexadecimal inválida'); o.num = parseInt(s.slice(i + 1, j), 16) >>> 0; return [o, j]; }
    if (c === 'f' || c === 'F') { if (/[a-zA-Z]/.test(s[i + 1] || '') ) throw new Unsupported('ponto flutuante'); throw new Unsupported('ponto flutuante'); }
    if (c === '{' || c === '@') throw new Unsupported('Recall/funções');
    if (c === 'v' || c === 'V' || c === '+' || c === '-') {
      let j = i + ((c === 'v' || c === 'V') ? 1 : 0), neg = false;
      if (s[j] === '-') { neg = true; j++; } else if (s[j] === '+') j++;
      const st = j; while (j < s.length && /\d/.test(s[j])) j++; if (j === st) throw new Error('número inválido');
      o.num = (neg ? -Number(s.slice(st, j)) : Number(s.slice(st, j))) >>> 0; return [o, j];
    }
    if (/\d/.test(c) && !(c === '0' && (s[i + 1] === 'x' || s[i + 1] === 'X'))) { let j = i; while (j < s.length && /\d/.test(s[j])) j++; o.num = Math.min(Number(s.slice(i, j)), 0xFFFFFFFF) >>> 0; return [o, j]; }
    // memória: [d|p|b|~] 0xSIZE ENDEREÇO
    let j = i; o.kind = 'mem';
    if (/[dDpPbB~]/.test(s[j]) && (s[j + 1] === '0' || /[fF]/.test(s[j + 1] || ''))) { o.view = { d: 'delta', p: 'prior', b: 'bcd', '~': 'inv' }[s[j].toLowerCase()]; j++; }
    if (s[j] === 'f' || s[j] === 'F') throw new Unsupported('ponto flutuante');
    if (s[j] !== '0' || (s[j + 1] !== 'x' && s[j + 1] !== 'X')) throw new Error('operando inválido em "' + s.slice(i, i + 12) + '"');
    j += 2;
    let sz = s[j];
    if (sz === ' ') j++; else if (SIZES[sz.toUpperCase()] && !/[0-9]/.test(sz)) { sz = sz.toUpperCase(); j++; } else sz = ' '; // sem letra de tamanho = 16 bits (formato antigo)
    if (!(sz in SIZES)) throw new Error('tamanho de memória desconhecido');
    o.size = SIZES[sz]; const st = j; while (j < s.length && hexv(s[j])) j++; if (j === st) throw new Error('endereço ausente');
    o.addr = parseInt(s.slice(st, j), 16) >>> 0; return [o, j];
  }
  const CT = { a: 'A', b: 'B', c: 'C', d: 'D', i: 'I', k: 'K', m: 'M', n: 'N', o: 'O', p: 'P', q: 'Q', r: 'R', t: 'T', z: 'Z', g: 'M' };
  function parseCondition(s, i) {
    const c = { type: 'S', op1: null, oper: '', op2: null, req: 0, hits: 0 };
    if (s[i + 1] === ':' && /[a-zA-Z]/.test(s[i])) { const t = CT[s[i].toLowerCase()]; if (!t) throw new Unsupported('tipo de condição ' + s[i]); if (t === 'K') throw new Unsupported('Remember'); c.type = t; i += 2; }
    let r = parseOperand(s, i); c.op1 = r[0]; i = r[1];
    const m = /^(==|=|!=|<=|>=|<|>|\*|\/|&|\^|%|\+|-)/.exec(s.slice(i, i + 2));
    if (m && !(s[i] === '-' && false)) { c.oper = m[1] === '==' ? '=' : m[1]; i += m[1].length; r = parseOperand(s, i); c.op2 = r[0]; i = r[1]; }
    if (s[i] === '(') { const e = s.indexOf(')', i); c.req = parseInt(s.slice(i + 1, e), 10) || 0; i = e + 1; }
    else if (s[i] === '.') { const e = s.indexOf('.', i + 1); c.req = parseInt(s.slice(i + 1, e), 10) || 0; i = e + 1; }
    if (!c.oper && !/[ABIK]/.test(c.type)) throw new Error('condição sem operador');
    return [c, i];
  }
  function parseTrigger(def) {
    const s = String(def || ''); const groups = []; let g = []; let i = 0;
    for (;;) {
      const [c, j] = parseCondition(s, i); g.push(c); i = j;
      if (i >= s.length) break;
      if (s[i] === '_') { i++; continue; }
      if (s[i] === 'S' || s[i] === 's') { groups.push(g); g = []; i++; continue; }
      throw new Error('caractere inesperado "' + s[i] + '"');
    }
    groups.push(g);
    return new Trigger(groups);
  }

  /* ---------- avaliação ---------- */
  const MOD = 'ABCDIKNOZ';
  class Trigger {
    constructor(groups) {
      this.state = 'waiting';
      this.groups = groups.map(conds => {
        const chains = []; let cur = [];
        for (const c of conds) { cur.push(c); if (!MOD.includes(c.type)) { chains.push(cur); cur = []; } }
        if (cur.length) chains.push(cur);
        return { conds, pause: chains.filter(ch => ch[ch.length - 1].type === 'P'), reset: chains.filter(ch => ch[ch.length - 1].type === 'R'), rest: chains.filter(ch => !'PR'.includes(ch[ch.length - 1].type)) };
      });
    }
    resetHits() { for (const g of this.groups) for (const c of g.conds) c.hits = 0; }
  }
  const u32 = v => v >>> 0;
  function arith(a, op, b) {
    switch (op) {
      case '*': return u32(Math.imul(a, b)); case '/': return b ? u32(Math.floor(a / b)) : 0; case '&': return u32(a & b); case '^': return u32(a ^ b);
      case '%': return b ? u32(a % b) : 0; case '+': return u32(a + b); case '-': return u32(a - b); default: return a;
    }
  }
  const cmpOp = { '=': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b };
  const bcd = v => { let r = 0, m = 1; while (v) { r += (v & 15) * m; m *= 10; v >>>= 4; } return r; };

  class Runner {
    constructor(read) { this.read = read; this.frame = 0; }
    rawRead(o, ind) {
      const a = u32(o.addr + ind), [k, n] = o.size; let v = 0;
      if (k === 'u') { for (let i = 0; i < n; i++) v += this.read(a + i) * Math.pow(256, i); }
      else if (k === 'be') { for (let i = 0; i < n; i++) v = v * 256 + this.read(a + i); }
      else { const b = this.read(a); v = k === 'b' ? (b >> n) & 1 : k === 'lo' ? b & 15 : k === 'hi' ? (b >> 4) & 15 : (b & 1) + ((b >> 1) & 1) + ((b >> 2) & 1) + ((b >> 3) & 1) + ((b >> 4) & 1) + ((b >> 5) & 1) + ((b >> 6) & 1) + ((b >> 7) & 1); }
      return v >>> 0;
    }
    val(o, ind) {
      if (o.kind === 'const') return o.num;
      const v = this.rawRead(o, o.view === 'addr' ? ind : ind);
      if (o.f !== this.frame) { o.f = this.frame; o.prev = o.has ? o.cur : v; o.cur = v; o.has = true; if (o.cur !== o.prev) o.prior = o.prev; }
      switch (o.view) {
        case 'delta': return o.prev; case 'prior': return o.prior; case 'bcd': return bcd(o.cur);
        case 'inv': { const [k, n] = o.size; const mask = k === 'u' || k === 'be' ? (n === 4 ? 0xFFFFFFFF : Math.pow(256, n) - 1) : k === 'b' ? 1 : 15; return u32(~o.cur) & mask; }
        default: return o.cur;
      }
    }
    /* uma condição "solta" (sem corrente de AddSource): devolve true/false conforme as regras de hits */
    cond(c, st, left, right) {
      let ok = cmpOp[c.oper] ? cmpOp[c.oper](left, right) : true;
      if (st.resetNext) { c.hits = 0; ok = false; }
      else {
        ok = (ok && st.andNext) || st.orNext;
        if (ok) {
          if (!st.dry) {
            if (c.req === 0) c.hits++;
            else if (c.hits < c.req) { c.hits++; ok = c.hits === c.req; }
          } else if (c.req) ok = c.hits >= c.req;
        } else if (c.hits > 0 && c.req > 0) ok = c.hits === c.req;
      }
      st.andNext = true; st.orNext = false; return ok;
    }
    chain(ch, st) {
      let acc = 0, ind = 0;
      for (const c of ch) {
        const t = c.type;
        if (t === 'A' || t === 'B') {
          const v = c.oper ? arith(this.val(c.op1, ind), c.oper, this.val(c.op2, ind)) : this.val(c.op1, ind);
          acc = t === 'A' ? u32(acc + v) : u32(acc - v); ind = 0; continue;
        }
        if (t === 'I') { ind = u32((c.oper ? arith(this.val(c.op1, ind), c.oper, this.val(c.op2, ind)) : this.val(c.op1, ind))); continue; }
        const left = c.oper && !cmpOp[c.oper] ? arith(this.val(c.op1, ind), c.oper, this.val(c.op2, ind)) : u32(this.val(c.op1, ind) + acc);
        const right = c.op2 && cmpOp[c.oper] ? this.val(c.op2, ind) : 0;
        acc = 0; ind = 0;
        if (t === 'C' || t === 'D') { this.cond(c, st, left, right); st.addHits += t === 'C' ? c.hits : -c.hits; st.resetNext = false; continue; }
        if (t === 'Z') { st.resetNext = this.cond(c, st, left, right); continue; }
        if (t === 'N') { st.andNext = this.cond(c, st, left, right); continue; }
        if (t === 'O') { st.orNext = this.cond(c, st, left, right); continue; }
        let ok = this.cond(c, st, left, right);
        if (st.addHits !== 0 && c.req !== 0) { const total = Math.max(0, c.hits + st.addHits); ok = total >= c.req; st.addHits = 0; }
        st.resetNext = false;
        if (t === 'P') { if (ok) { st.paused = true; st.isTrue = false; } else if (c.req === 0) c.hits = 0; }
        else if (t === 'R') { if (ok) { st.wasReset = true; st.isTrue = false; } }
        else if (t === 'T') st.isTrue = st.isTrue && ok;
        else st.isTrue = st.isTrue && ok;
        if (st.paused) break;
      }
    }
    group(g, st0) {
      const st = { isTrue: true, paused: false, wasReset: st0.wasReset, andNext: true, orNext: false, resetNext: false, addHits: 0, dry: false };
      for (const ch of g.pause) { this.chain(ch, st); if (st.paused) break; }
      if (st.paused) { st.dry = true; for (const ch of g.reset.concat(g.rest)) this.chain(ch, st); st.isTrue = false; }
      else { for (const ch of g.reset) this.chain(ch, st); for (const ch of g.rest) this.chain(ch, st); }
      st0.wasReset = st.wasReset; return st;
    }
    /* avalia o gatilho por um quadro; devolve true quando a conquista dispara */
    test(trig) {
      this.frame++;
      const s0 = { wasReset: false }; const core = this.group(trig.groups[0], s0);
      let ret = core.isTrue, paused = core.paused;
      if (trig.groups.length > 1) {
        let any = false, allPaused = true;
        for (let i = 1; i < trig.groups.length; i++) { const r = this.group(trig.groups[i], s0); any = any || r.isTrue; allPaused = allPaused && r.paused; }
        ret = ret && any; paused = paused || allPaused;
      }
      if (s0.wasReset) { trig.resetHits(); return false; }
      if (ret) { if (trig.state === 'waiting') { trig.resetHits(); return false; } trig.state = 'triggered'; return true; }
      trig.state = paused ? 'paused' : 'active'; return false;
    }
  }

  /* ---------- API ---------- */
  const HOST = 'https://retroachievements.org/dorequest.php';
  const UA = 'EmuHub/1.0';
  class Client {
    /* transport(url, fields) -> Promise<objeto JSON> ; é injetado para poder testar sem rede */
    constructor(transport) { this.tx = transport; this.user = ''; this.token = ''; }
    async call(fields) { const r = await this.tx(HOST, fields); if (r && r.Success === false) { const e = new Error(r.Error || 'a RetroAchievements recusou o pedido'); e.code = r.Code; throw e; } return r; }
    async login(user, password) { const r = await this.call({ r: 'login2', u: user, p: password }); this.user = r.User || user; this.token = r.Token; return { user: this.user, token: this.token, score: r.SoftcoreScore || r.Score || 0 }; }
    use(user, token) { this.user = user; this.token = token; }
    auth(extra) { return Object.assign({ u: this.user, t: this.token }, extra); }
    async gameId(hash) { const r = await this.call({ r: 'gameid', m: hash }); return r.GameID || 0; }
    async patch(gameId) { const r = await this.call(this.auth({ r: 'patch', g: gameId })); return r.PatchData; }
    async startSession(gameId, hash) { return this.call(this.auth({ r: 'startsession', g: gameId, h: 0, m: hash, l: '1.0' })); }
    async award(id, hash, secondsAgo) {
      const o = secondsAgo ? Math.round(secondsAgo) : 0;
      const v = md5(String(id) + this.user + '0' + (o ? String(id) + String(o) : ''));
      return this.call(this.auth(Object.assign({ r: 'awardachievement', a: id, h: 0, m: hash, v }, o ? { o } : {})));
    }
    ping(gameId) { return this.call(this.auth({ r: 'ping', g: gameId })).catch(() => {}); }
  }

  /* ---------- sessão de um jogo ---------- */
  class Session {
    constructor(core, con, patch, unlockedIds) {
      this.runner = new Runner(makeReader(core, con)); this.list = []; this.active = []; this.got = new Set(unlockedIds || []);
      this.title = patch.Title; this.gameId = patch.ID; this.icon = patch.ImageIcon;
      for (const a of patch.Achievements || []) {
        if (a.Flags !== 3 && a.Flags !== undefined) continue; // só as oficiais (promovidas)
        const e = { id: a.ID, title: a.Title, desc: a.Description, pts: a.Points, badge: a.BadgeName, trig: null, bad: '' };
        try { e.trig = parseTrigger(a.MemAddr); } catch (er) { e.bad = er instanceof Unsupported ? 'não suportada (' + er.message + ')' : 'regra inválida'; }
        this.list.push(e); if (e.trig && !this.got.has(e.id)) this.active.push(e);
      }
      this.onUnlock = null;
    }
    tick() {
      for (let i = this.active.length - 1; i >= 0; i--) {
        const e = this.active[i];
        let hit = false; try { hit = this.runner.test(e.trig); } catch (er) { e.bad = 'erro ao avaliar'; this.active.splice(i, 1); continue; }
        if (hit) { this.active.splice(i, 1); this.got.add(e.id); if (this.onUnlock) this.onUnlock(e); }
      }
    }
  }
  return { md5, hashRom, makeReader, parseTrigger, Runner, Client, Session, CONSOLE_ID, Unsupported };
})();
if (typeof module !== 'undefined') module.exports = RA;
