# Gera src/data/chtidx.b64 (gzip+base64) com os nomes reais dos arquivos .cht do libretro-database.
# Uso: python3 tools/gen-cht-index.py /caminho/libretro-database
import sys, os, gzip, base64, json
root = sys.argv[1]
SYS = {'nes': 'Nintendo - Nintendo Entertainment System', 'snes': 'Nintendo - Super Nintendo Entertainment System',
       'gb': 'Nintendo - Game Boy', 'gbc': 'Nintendo - Game Boy Color', 'gba': 'Nintendo - Game Boy Advance'}
idx = {k: sorted(f[:-4] for f in os.listdir(os.path.join(root, 'cht', v)) if f.endswith('.cht')) for k, v in SYS.items()}
raw = json.dumps(idx, separators=(',', ':'), ensure_ascii=False).encode()
out = base64.b64encode(gzip.compress(raw, 9)).decode()
open(os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'chtidx.b64'), 'w').write(out)
print(len(raw), '->', len(out))
