'use strict';
/* Save states genéricos: percorre o objeto do emulador e guarda números, booleanos, strings e
 * arrays tipados por caminho ("cpu.r", "bus.ewram.u8"...). Na leitura, só escreve onde o caminho
 * existe, então campos novos ou ausentes não desalinham nada. ROM e buffers de saída ficam de fora. */
function emuStateSave(root, skip) {
  const scal = {}, arrs = [], seen = new Set(), bufs = new Set();
  let total = 0;
  (function walk(o, path) {
    if (seen.has(o)) return; seen.add(o);
    const keys = Array.isArray(o) ? o.map((_, i) => i) : Object.keys(o);
    for (const k of keys) {
      if (typeof k === 'string' && skip.has(k)) continue;
      const v = o[k], p = path ? path + '.' + k : String(k), t = typeof v;
      if (t === 'number' || t === 'boolean' || t === 'string') scal[p] = v;
      else if (v && t === 'object') {
        if (ArrayBuffer.isView(v)) {
          if (bufs.has(v.buffer)) continue; bufs.add(v.buffer);
          arrs.push([p, v.constructor.name, v.byteLength, v.byteOffset]); total += v.byteLength;
        } else walk(v, p);
      }
    }
  })(root, '');
  // reconstrói a lista de blocos na ordem em que foram achados
  const head = JSON.stringify({ s: scal, a: arrs.map(a => [a[0], a[1], a[2]]) });
  const hb = new TextEncoder().encode(head), out = new Uint8Array(4 + hb.length + total);
  new DataView(out.buffer).setUint32(0, hb.length, true); out.set(hb, 4);
  let off = 4 + hb.length;
  const byPath = {};
  (function walk2(o, path, seen2) {
    if (seen2.has(o)) return; seen2.add(o);
    const keys = Array.isArray(o) ? o.map((_, i) => i) : Object.keys(o);
    for (const k of keys) {
      if (typeof k === 'string' && skip.has(k)) continue;
      const v = o[k], p = path ? path + '.' + k : String(k);
      if (v && typeof v === 'object') { if (ArrayBuffer.isView(v)) byPath[p] = v; else walk2(v, p, seen2); }
    }
  })(root, '', new Set());
  for (const [p, , n] of arrs) { out.set(new Uint8Array(byPath[p].buffer, byPath[p].byteOffset, n), off); off += n; }
  return out;
}

function emuStateLoad(root, skip, data) {
  const hl = new DataView(data.buffer, data.byteOffset).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(data.subarray(4, 4 + hl)));
  const blocks = {}; let off = 4 + hl;
  for (const [p, , n] of head.a) { blocks[p] = data.subarray(off, off + n); off += n; }
  const seen = new Set(), done = new Set();
  (function walk(o, path) {
    if (seen.has(o)) return; seen.add(o);
    const keys = Array.isArray(o) ? o.map((_, i) => i) : Object.keys(o);
    for (const k of keys) {
      if (typeof k === 'string' && skip.has(k)) continue;
      const v = o[k], p = path ? path + '.' + k : String(k), t = typeof v;
      if (t === 'number' || t === 'boolean' || t === 'string') { if (p in head.s && typeof head.s[p] === t) o[k] = head.s[p]; }
      else if (v && t === 'object') {
        if (ArrayBuffer.isView(v)) {
          if (done.has(v.buffer)) continue; done.add(v.buffer);
          const b = blocks[p];
          if (b && b.length === v.byteLength) new Uint8Array(v.buffer, v.byteOffset, v.byteLength).set(b);
        } else walk(v, p);
      }
    }
  })(root, '');
}
