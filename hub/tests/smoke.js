// Fumaça no navegador (Playwright): início, abas por console, ajustes em páginas, gaveta de exibição, abrir console e menu do jogo.
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(), errs = [], chk = (c, m) => { if (!c) errs.push(m); };
  for (const [w, h] of [[390, 844], [844, 390]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: true }); p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + path.join(__dirname, '..', 'dist', 'emu-hub.html')); await p.waitForTimeout(400);
    chk(await p.locator('#conTabs button').count() === 7, 'abas de console');
    await p.click('#conTabs button:nth-child(3)'); chk(await p.evaluate(() => document.body.dataset.con) === 'snes', 'filtro por console');
    await p.click('#bSettings'); chk(await p.isVisible('#setMenu'), 'lista de ajustes');
    await p.click('#setMenu .li[data-go="ui"]'); chk(await p.isVisible('#segAcc'), 'página de interface'); chk(!(await p.isVisible('#segPad')), 'páginas separadas');
    await p.click('#bSetBack'); await p.click('#bSetBack'); chk(await p.isVisible('#bFab'), 'volta ao início');
    await p.click('#bView'); await p.waitForTimeout(300); await p.click('#shClose'); await p.waitForTimeout(300);
    await p.click('#bMenu'); await p.click('.menu button:nth-child(2)'); await p.waitForTimeout(300); await p.click('#grid .li:nth-child(2)'); await p.waitForTimeout(400);
    await p.click('#bTools'); await p.waitForTimeout(300);
    chk(await p.evaluate(() => getComputedStyle(document.getElementById('pad')).visibility) === 'hidden', 'botões na tela visíveis com a gaveta aberta');
    await p.click('#shClose'); await p.waitForTimeout(300); await p.click('#bBack'); await p.close();
  }
  await b.close();
  console.log(errs.length ? 'FALHOU: ' + errs.join('; ') : 'TUDO OK (smoke)'); process.exit(errs.length ? 1 : 0);
})();
