// Fumaça no navegador (Playwright): abre o hub, passa pelas abas, abre um console e a gaveta; falha com qualquer erro de script.
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(), errs = [];
  for (const [w, h] of [[390, 844], [844, 390]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: true }); p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + path.join(__dirname, '..', 'dist', 'emu-hub.html')); await p.waitForTimeout(400);
    for (const n of [3, 2, 1]) { await p.click('#tabs button:nth-child(' + n + ')'); await p.waitForTimeout(100); }
    await p.click('#tabs button:nth-child(2)'); await p.click('#grid > *:nth-child(2)'); await p.waitForTimeout(400);
    await p.click('#bTools'); await p.waitForTimeout(300);
    const hid = await p.evaluate(() => getComputedStyle(document.getElementById('pad')).visibility);
    if (hid !== 'hidden') errs.push('botões na tela visíveis com a gaveta aberta');
    await p.click('#shClose'); await p.waitForTimeout(300); await p.click('#bBack'); await p.close();
  }
  await b.close();
  console.log(errs.length ? 'FALHOU: ' + errs.join('; ') : 'TUDO OK (smoke)'); process.exit(errs.length ? 1 : 0);
})();
