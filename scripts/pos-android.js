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
    registerPlugin(FolderPickerPlugin.class);
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

// Plugin nativo: seletor de pasta do sistema (Storage Access Framework). O WebView não abre showDirectoryPicker.
fs.writeFileSync(path.join(dir, 'FolderPickerPlugin.java'), `package com.rapzin.emuhub;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

@CapacitorPlugin(name = "FolderPicker")
public class FolderPickerPlugin extends Plugin {
  private static final Set<String> EXT = new HashSet<>(Arrays.asList("nes", "sfc", "smc", "gb", "gbc", "sms", "gg", "gba", "zip", "png", "jpg", "jpeg", "webp"));

  @PluginMethod
  public void pickFolder(PluginCall call) {
    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
    startActivityForResult(call, i, "pickResult");
  }

  @ActivityCallback
  private void pickResult(PluginCall call, ActivityResult r) {
    if (call == null) return;
    if (r.getResultCode() != Activity.RESULT_OK || r.getData() == null || r.getData().getData() == null) { call.reject("cancelado"); return; }
    Uri u = r.getData().getData();
    try { getContext().getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception e) { /* segue com a permissão temporária */ }
    String id = DocumentsContract.getTreeDocumentId(u), name = id.contains(":") ? id.substring(id.indexOf(':') + 1) : id;
    if (name.isEmpty()) name = "armazenamento"; else if (name.contains("/")) name = name.substring(name.lastIndexOf('/') + 1);
    JSObject o = new JSObject();
    o.put("uri", u.toString());
    o.put("name", name);
    call.resolve(o);
  }

  @PluginMethod
  public void list(PluginCall call) {
    String s = call.getString("uri");
    if (s == null) { call.reject("sem uri"); return; }
    Uri tree = Uri.parse(s);
    JSArray out = new JSArray();
    try { walk(tree, DocumentsContract.getTreeDocumentId(tree), 0, out); } catch (Exception e) { call.reject(String.valueOf(e.getMessage())); return; }
    JSObject o = new JSObject();
    o.put("files", out);
    call.resolve(o);
  }

  private void walk(Uri tree, String docId, int depth, JSArray out) {
    Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
    String[] cols = { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE };
    try (Cursor c = getContext().getContentResolver().query(kids, cols, null, null, null)) {
      if (c == null) return;
      while (c.moveToNext()) {
        String id = c.getString(0), name = c.getString(1), mime = c.getString(2);
        if (name == null) continue;
        if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) { if (depth < 3) walk(tree, id, depth + 1, out); continue; }
        int dot = name.lastIndexOf('.');
        if (dot < 0 || !EXT.contains(name.substring(dot + 1).toLowerCase(Locale.ROOT))) continue;
        JSObject f = new JSObject();
        f.put("name", name);
        f.put("size", c.isNull(3) ? 0 : c.getLong(3));
        f.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString());
        out.put(f);
      }
    }
  }

  @PluginMethod
  public void read(PluginCall call) {
    String s = call.getString("uri");
    if (s == null) { call.reject("sem uri"); return; }
    int off = call.getInt("offset", 0), len = call.getInt("length", 4194304);
    try (InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(s))) {
      if (in == null) { call.reject("não abriu"); return; }
      long skipped = 0;
      while (skipped < off) { long k = in.skip(off - skipped); if (k <= 0) break; skipped += k; }
      byte[] buf = new byte[len];
      int n = 0, r;
      while (n < len && (r = in.read(buf, n, len - n)) > 0) n += r;
      JSObject o = new JSObject();
      o.put("data", Base64.encodeToString(buf, 0, n, Base64.NO_WRAP));
      o.put("n", n);
      call.resolve(o);
    } catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
  }
}
`);
// remove a MainActivity padrão se estiver em outro pacote
console.log('Android ajustado (imersivo + vibração).');
