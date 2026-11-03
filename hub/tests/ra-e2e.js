// Ponta a ponta no navegador com um servidor da RetroAchievements simulado: login, jogo reconhecido, conquista dispara e é enviada
const { chromium } = require('playwright'); const path = require('path');
const rom = new Uint8Array(16 + 16384 + 8192); rom.set([0x4E, 0x45, 0x53, 0x1A, 1, 1, 0, 0]);
rom.set([0xE6, 0x10, 0x4C, 0x00, 0xC0], 16); rom[16 + 0x3FFA] = 0; rom[16 + 0x3FFB] = 0xC0; rom[16 + 0x3FFC] = 0; rom[16 + 0x3FFD] = 0xC0; rom[16 + 0x3FFE] = 0; rom[16 + 0x3FFF] = 0xC0;
(async () => {
  const b = await chromium.launch(), errs = [], chk = (c, m) => { console.log(c ? 'ok:' : 'FALHOU:', m); if (!c) errs.push(m); };
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true }); p.on('pageerror', e => errs.push('erro de página: ' + e.message));
  await p.addInitScript(() => {
    window.__ra = [];
    window.fetch = async (url, o) => {
      const f = Object.fromEntries(new URLSearchParams(o.body)); window.__ra.push(f); let r = { Success: true };
      if (f.r === 'login2') r = f.p === 'senha' ? { Success: true, User: 'Rapzin', Token: 'TOK123', SoftcoreScore: 0 } : { Success: false, Error: 'Invalid credentials', Code: 'invalid_credentials' };
      else if (f.r === 'gameid') r = { Success: true, GameID: 77 };
      else if (f.r === 'patch') r = { Success: true, PatchData: { ID: 77, Title: 'Jogo de Teste', ConsoleID: 7, ImageIcon: '', Achievements: [
        { ID: 501, Title: 'Chegou no cinco', Description: 'Faça o contador valer 5', Points: 10, MemAddr: '0xH0010=5', Flags: 3, BadgeName: '1' },
        { ID: 502, Title: 'Avançada', Description: 'Usa float', Points: 5, MemAddr: 'fF0010=1.5', Flags: 3, BadgeName: '2' }] } };
      else if (f.r === 'startsession') r = { Success: true, Unlocks: [], HardcoreUnlocks: [] };
      else if (f.r === 'awardachievement') r = { Success: true, AchievementsRemaining: 1 };
      return { json: async () => r };
    };
  });
  await p.goto('file://' + path.join(__dirname, '..', 'dist', 'emu-hub.html')); await p.waitForTimeout(400);
  await p.click('#bSettings'); await p.click('#setMenu .li[data-go="ra"]');
  await p.fill('#raUser', 'Rapzin'); await p.fill('#raPass', 'errada'); await p.click('#raLogin'); await p.waitForTimeout(300);
  chk((await p.textContent('#raErr')).includes('Invalid credentials'), 'senha errada mostra o erro do servidor');
  await p.fill('#raPass', 'senha'); await p.click('#raLogin'); await p.waitForTimeout(400);
  chk((await p.textContent('#raStatus')).includes('Rapzin'), 'conectado como Rapzin');
  chk(await p.evaluate(() => localStorage.getItem('ra_auth').includes('TOK123') && !localStorage.getItem('ra_auth').includes('senha')), 'guarda o token e não a senha');
  await p.click('#bSetBack'); await p.click('#bSetBack');
  await p.setInputFiles('#fileAny', { name: 'teste.nes', mimeType: 'application/octet-stream', buffer: Buffer.from(rom) }); await p.waitForTimeout(1500);
  const got = await p.evaluate(() => window.__ra.map(x => x.r));
  chk(got.includes('gameid') && got.includes('patch') && got.includes('startsession'), 'reconhece o jogo e baixa as conquistas: ' + got.join(','));
  await p.waitForTimeout(2500);
  const aw = await p.evaluate(() => window.__ra.filter(x => x.r === 'awardachievement'));
  chk(aw.length === 1 && aw[0].a === '501' && aw[0].h === '0' && aw[0].t === 'TOK123', 'enviou o desbloqueio em modo casual com o token: ' + JSON.stringify(aw));
  chk(await p.evaluate(() => document.getElementById('achPop').classList.contains('on') || document.getElementById('achPop').textContent.includes('Chegou')), 'mostrou o aviso de conquista');
  await p.click('#bTools'); await p.waitForTimeout(300); await p.click('#bAch'); await p.waitForTimeout(300);
  const txt = await p.textContent('#raList'); chk(txt.includes('Chegou no cinco') && txt.includes('não suportada'), 'lista com a conquista ganha e a não suportada');
  chk((await p.textContent('#raBarTx')).startsWith('1/2'), 'progresso 1/2');
  await b.close();
  console.log(errs.length ? 'FALHOU: ' + errs.join('; ') : 'TUDO OK (RA e2e)'); process.exit(errs.length ? 1 : 0);
})();
