package io.github.djmorgan26.fantasypanel;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

/**
 * The menu you drive with the remote: watch a game, pick the league the
 * panel shows, switch or hide the panel. It is an ordinary activity, so it
 * has focus only while it is open; Back (or opening a game) closes it, and
 * every key then goes to the app you are watching again. The panel itself
 * stays a non-focusable overlay.
 */
public class MenuActivity extends Activity {
    private WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());

    @SuppressLint("JavascriptInterface")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Open the panel alongside, in the layout you used last.
        if (!OverlayService.isShowing()) {
            OverlayService.send(this, OverlayService.ACTION_SHOW, Prefs.mode(this));
        }
        web = WebHost.create(this, v -> finish());
        Bridge b = new Bridge();
        web.addJavascriptInterface(b, "FFNative");
        web.addJavascriptInterface(b, "FFMenu");
        setContentView(web);
        web.loadUrl(WebHost.ORIGIN + "menu.html");
        web.requestFocus();
        Log.i(OverlayService.TAG, "menu opened");
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        // Back always closes the menu; the page never sees it.
        if (e.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            if (e.getAction() == KeyEvent.ACTION_UP) close();
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    private void close() {
        if (isFinishing()) return;
        Log.i(OverlayService.TAG, "menu closed");
        finish();
        if (Build.VERSION.SDK_INT >= 34) {
            overrideActivityTransition(OVERRIDE_TRANSITION_CLOSE, 0, 0);
        } else {
            noAnimation();
        }
    }

    @SuppressWarnings("deprecation")
    private void noAnimation() {
        overridePendingTransition(0, 0);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.stopLoading();
            web.removeJavascriptInterface("FFNative");
            web.removeJavascriptInterface("FFMenu");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** What the menu page may ask for. Every call is checked here. */
    private class Bridge {
        @JavascriptInterface
        public String getConfig() {
            return WebHost.publicConfig(MenuActivity.this);
        }

        @JavascriptInterface
        public String getFocus() {
            return Prefs.focus(MenuActivity.this);
        }

        @JavascriptInterface
        public String getSnapshot() {
            return OverlayService.snapshot();
        }

        @JavascriptInterface
        public String getState() {
            JSONObject o = new JSONObject();
            try {
                JSONObject cfg = Prefs.config(MenuActivity.this);
                JSONObject panel = cfg != null ? cfg.optJSONObject("panel") : null;
                o.put("showing", OverlayService.isShowing());
                o.put("mode", OverlayService.isShowing() ? OverlayService.shownMode() : Prefs.mode(MenuActivity.this));
                o.put("focus", Prefs.focus(MenuActivity.this));
                o.put("side", panel != null && "left".equals(panel.optString("side")) ? "left" : "right");
                o.put("installed", Watch.installedMap(MenuActivity.this));
            } catch (Exception ignored) {
                // a partial state is still useful
            }
            return o.toString();
        }

        @JavascriptInterface
        public boolean setFocus(String key) {
            Prefs.setFocus(MenuActivity.this, key);
            Log.i(OverlayService.TAG, "menu: show " + Prefs.focus(MenuActivity.this));
            OverlayService.send(MenuActivity.this, OverlayService.ACTION_FOCUS);
            return true;
        }

        @JavascriptInterface
        public boolean setMode(String mode) {
            Log.i(OverlayService.TAG, "menu: layout " + mode);
            if ("hide".equals(mode)) {
                OverlayService.send(MenuActivity.this, OverlayService.ACTION_HIDE);
            } else {
                String m = OverlayService.MODE_MINI.equals(mode) ? OverlayService.MODE_MINI : OverlayService.MODE_FULL;
                OverlayService.send(MenuActivity.this, OverlayService.ACTION_SHOW, m);
            }
            return true;
        }

        @JavascriptInterface
        public boolean watch(String provider, String query) {
            boolean ok = Watch.open(MenuActivity.this, provider, query);
            if (ok) {
                // Keep the scores up beside the game, then get out of the way.
                if (!OverlayService.isShowing()) {
                    OverlayService.send(MenuActivity.this, OverlayService.ACTION_SHOW, Prefs.mode(MenuActivity.this));
                }
                main.post(MenuActivity.this::finish);
            }
            return ok;
        }

        @JavascriptInterface
        public void close() {
            main.post(MenuActivity.this::close);
        }
    }
}
