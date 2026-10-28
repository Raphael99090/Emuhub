// Ajustes no projeto Android gerado por "npx cap add android": tela cheia imersiva e permissão de vibração.
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, '..', 'android', 'app', 'src', 'main');
const man = path.join(base, 'AndroidManifest.xml');
let x = fs.readFileSync(man, 'utf8');
if (!x.includes('android.permission.VIBRATE')) x = x.replace('</manifest>', '    <uses-permission android:name="android.permission.VIBRATE" />\n</manifest>');
// aceita rotação livre e não recria a atividade ao girar (o jogo continua rodando)
if (!x.includes('screenOrientation')) x = x.replace('<activity', '<activity android:screenOrientation="fullSensor"');
fs.writeFileSync(man, x);
const dir = path.join(base, 'java', 'com', 'rapzin', 'emuhub');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'MainActivity.java'), `package com.rapzin.emuhub;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (Build.VERSION.SDK_INT >= 28) getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
    imersivo();
  }
  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) imersivo();
  }
  private void imersivo() {
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    WindowInsetsControllerCompat c = new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
    c.hide(WindowInsetsCompat.Type.systemBars());
    c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
  }
}
`);
// remove a MainActivity padrão se estiver em outro pacote
console.log('Android ajustado (imersivo + vibração).');
