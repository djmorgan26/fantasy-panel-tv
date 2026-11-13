package io.github.djmorgan26.fantasypanel;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.view.Display;
import android.view.Gravity;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.HashMap;
import java.util.Map;

/**
 * Hosts the panel: a WebView in a non-focusable, non-touchable overlay window
 * docked to one side of the screen. Input always goes to the app underneath.
 * The service exists only while the panel is visible; hiding it tears the
 * WebView down and stops the service, so nothing runs in the background.
 */
public class OverlayService extends Service {
    static final String TAG = "FantasyPanel";
    static final String ACTION_SHOW = "show";
    static final String ACTION_HIDE = "hide";
    static final String ACTION_TOGGLE = "toggle";
    static final String ACTION_RELOAD = "reload";
    static final String MODE_FULL = "full";
    static final String MODE_MINI = "mini";
    private static final String EXTRA_MODE = "mode";
    /** The page lays itself out at this many CSS px wide. */
    private static final double DESIGN_WIDTH = 480.0;

    private static final String ORIGIN_HOST = "panel.local";
    private static final String ORIGIN = "https://" + ORIGIN_HOST + "/";
    private static final String CHANNEL = "panel";
    private static final Set<String> DATA_HOSTS = new HashSet<>(Arrays.asList(
            "api.sleeper.app", "lm-api-reads.fantasy.espn.com", "site.api.espn.com"));
    private static final int NOTIFICATION_ID = 1;

    private static volatile boolean showing = false;

    private WindowManager windowManager;
    private WebView webView;
    private int panelWidth;
    private boolean leftSide;
    private String mode = MODE_FULL;
    private WindowManager.LayoutParams params;

    /**
     * Closes the panel when the TV goes to sleep, or when Home is pressed
     * (the system announces that as CLOSE_SYSTEM_DIALOGS with reason
     * "homekey"). We only listen; Home still goes home as usual.
     */
    private static final String CLOSE_DIALOGS = "android.intent.action.CLOSE_SYSTEM_DIALOGS";
    private final BroadcastReceiver screenOff = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            if (Intent.ACTION_SCREEN_OFF.equals(i.getAction())) {
                Log.i(TAG, "close: screen off");
                hide();
            } else if (CLOSE_DIALOGS.equals(i.getAction())) {
                String reason = i.getStringExtra("reason");
                Log.i(TAG, "system dialogs closed, reason=" + reason);
                if ("homekey".equals(reason)) {
                    Log.i(TAG, "close: home pressed");
                    hide();
                }
            }
        }
    };
    private boolean screenOffRegistered = false;

    static boolean isShowing() {
        return showing;
    }

    static void send(Context ctx, String action) {
        send(ctx, action, MODE_FULL);
    }

    static void send(Context ctx, String action, String mode) {
        Intent i = new Intent(ctx, OverlayService.class).setAction(action).putExtra(EXTRA_MODE, mode);
        if (ACTION_HIDE.equals(action) && !showing) return;
        ctx.startForegroundService(i);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Every start must promote to foreground promptly, even a hide.
        goForeground();
        String action = intent != null && intent.getAction() != null ? intent.getAction() : ACTION_TOGGLE;
        String wanted = intent != null && MODE_MINI.equals(intent.getStringExtra(EXTRA_MODE)) ? MODE_MINI : MODE_FULL;
        Log.i(TAG, "command " + action + " (" + wanted + "), panel " + (webView == null ? "hidden" : "showing " + mode));
        if (!Settings.canDrawOverlays(this)) {
            Log.w(TAG, "overlay permission missing");
            stopEverything();
            return START_NOT_STICKY;
        }
        switch (action) {
            case ACTION_SHOW:
                if (webView == null) show(wanted);
                else if (!wanted.equals(mode)) switchMode(wanted);
                break;
            case ACTION_HIDE:
                hide();
                break;
            case ACTION_RELOAD:
                if (webView != null) {
                    applyCookies();
                    webView.reload();
                } else {
                    stopEverything();
                }
                break;
            default:
                // Same command again hides; the other command switches layouts.
                if (webView == null) show(wanted);
                else if (!wanted.equals(mode)) switchMode(wanted);
                else hide();
        }
        // If Android ever kills us, do not resurrect the panel on its own.
        return START_NOT_STICKY;
    }

    private void goForeground() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                    new NotificationChannel(CHANNEL, "Scores panel", NotificationManager.IMPORTANCE_MIN));
        }
        Notification n = new Notification.Builder(this, CHANNEL)
                .setContentTitle(getString(R.string.app_name))
                .setContentText("Scores panel is showing")
                .setSmallIcon(R.drawable.ic_stat)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    private void switchMode(String wanted) {
        WebView old = webView;
        webView = null;
        destroyView(old);
        show(wanted);
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface", "UnspecifiedRegisterReceiverFlag"})
    private void show(String wanted) {
        mode = wanted;
        if (!getSystemService(PowerManager.class).isInteractive()) {
            Log.i(TAG, "screen is off, not showing");
            stopEverything();
            return;
        }
        Context ctx = this;
        if (Build.VERSION.SDK_INT >= 30) {
            Display display = getSystemService(android.hardware.display.DisplayManager.class)
                    .getDisplay(Display.DEFAULT_DISPLAY);
            ctx = createDisplayContext(display)
                    .createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, null);
        }
        windowManager = ctx.getSystemService(WindowManager.class);

        JSONObject cfg = Prefs.config(this);
        JSONObject panel = cfg != null ? cfg.optJSONObject("panel") : null;
        double widthFrac = panel != null ? panel.optDouble("width", 0.26) : 0.26;
        widthFrac = Math.max(0.18, Math.min(0.4, widthFrac));
        leftSide = panel != null && "left".equals(panel.optString("side"));

        int screenWidth;
        if (Build.VERSION.SDK_INT >= 30) {
            Rect b = windowManager.getMaximumWindowMetrics().getBounds();
            screenWidth = b.width();
        } else {
            screenWidth = getResources().getDisplayMetrics().widthPixels;
        }
        panelWidth = (int) Math.round(screenWidth * widthFrac);

        webView = new WebView(ctx);
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.setFocusable(false);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        applyCookies();
        webView.addJavascriptInterface(new Bridge(), "FFNative");
        webView.setWebViewClient(new AssetClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i(TAG, "page: " + m.message());
                return true;
            }
        });

        boolean mini = MODE_MINI.equals(mode);
        int margin = mini ? (int) Math.round(panelWidth * 0.06) : 0;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                panelWidth,
                // The mini card starts small and is sized by the page (setContentHeight).
                mini ? (int) Math.round(panelWidth * 0.4) : WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                // NOT_FOCUSABLE: remote keys always go to the app you are watching.
                // Deliberately not NOT_TOUCHABLE: Android 12+ caps touch-through
                // overlays at 80% opacity, which washes the panel out, and a TV
                // has no touchscreen to pass touches to anyway.
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | (leftSide ? Gravity.START : Gravity.END);
        lp.x = margin;
        lp.y = margin;
        lp.setTitle("FantasyPanel");
        params = lp;

        webView.setTranslationX(leftSide ? -panelWidth : panelWidth);
        webView.setAlpha(0f);
        windowManager.addView(webView, lp);
        webView.loadUrl(ORIGIN + "index.html" + (mini ? "?mode=mini" : ""));
        webView.animate().translationX(0).alpha(1f).setDuration(420)
                .setInterpolator(new DecelerateInterpolator(2.2f)).start();
        showing = true;
        if (!screenOffRegistered) {
            IntentFilter f = new IntentFilter(Intent.ACTION_SCREEN_OFF);
            f.addAction(CLOSE_DIALOGS);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(screenOff, f, Context.RECEIVER_NOT_EXPORTED);
            else registerReceiver(screenOff, f);
            screenOffRegistered = true;
        }
        Log.i(TAG, "panel shown (" + mode + "), width " + panelWidth + "px");
    }

    private void hide() {
        Log.i(TAG, "hiding panel");
        if (webView == null) {
            stopEverything();
            return;
        }
        final WebView v = webView;
        webView = null;
        showing = false;
        v.animate().translationX(leftSide ? -panelWidth : panelWidth).alpha(0f).setDuration(320)
                .withEndAction(() -> {
                    destroyView(v);
                    // A quick re-toggle may have opened a new panel meanwhile.
                    if (webView == null) stopEverything();
                }).start();
    }

    private void destroyView(WebView v) {
        try {
            windowManager.removeView(v);
        } catch (RuntimeException e) {
            Log.w(TAG, "removeView", e);
        }
        v.stopLoading();
        v.removeJavascriptInterface("FFNative");
        v.destroy();
    }

    private void stopEverything() {
        showing = false;
        if (screenOffRegistered) {
            unregisterReceiver(screenOff);
            screenOffRegistered = false;
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (screenOffRegistered) {
            unregisterReceiver(screenOff);
            screenOffRegistered = false;
        }
        if (webView != null) {
            destroyView(webView);
            webView = null;
        }
        showing = false;
        super.onDestroy();
    }

    /** ESPN private leagues: hand the user's cookies to the WebView only. */
    private void applyCookies() {
        JSONObject cfg = Prefs.config(this);
        if (cfg == null) return;
        JSONArray espn = cfg.optJSONArray("espn");
        if (espn == null) return;
        CookieManager cm = CookieManager.getInstance();
        for (int i = 0; i < espn.length(); i++) {
            JSONObject e = espn.optJSONObject(i);
            if (e == null) continue;
            String s2 = e.optString("espn_s2", "");
            String swid = e.optString("swid", "");
            String attrs = "; Domain=.espn.com; Path=/; Secure; SameSite=None";
            if (!s2.isEmpty()) cm.setCookie("https://lm-api-reads.fantasy.espn.com", "espn_s2=" + s2 + attrs);
            if (!swid.isEmpty()) cm.setCookie("https://lm-api-reads.fantasy.espn.com", "SWID=" + swid + attrs);
        }
        cm.flush();
    }

    /** Read-only bridge: the page can read its config and size the mini card. */
    private class Bridge {
        @JavascriptInterface
        public void setContentHeight(final int cssPx) {
            if (cssPx < 40 || cssPx > 2000) return;
            new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
                if (webView == null || params == null || !MODE_MINI.equals(mode)) return;
                int h = (int) Math.ceil(cssPx * panelWidth / DESIGN_WIDTH);
                if (Math.abs(params.height - h) < 2) return;
                params.height = h;
                try {
                    windowManager.updateViewLayout(webView, params);
                } catch (RuntimeException e) {
                    Log.w(TAG, "resize", e);
                }
            });
        }

        @JavascriptInterface
        public String getConfig() {
            JSONObject cfg = Prefs.config(OverlayService.this);
            if (cfg == null) return null;
            try {
                // Cookies never need to reach page script; the WebView sends them.
                JSONObject copy = new JSONObject(cfg.toString());
                JSONArray espn = copy.optJSONArray("espn");
                if (espn != null) {
                    for (int i = 0; i < espn.length(); i++) {
                        JSONObject e = espn.optJSONObject(i);
                        if (e == null) continue;
                        boolean priv = !e.optString("espn_s2", "").isEmpty();
                        e.remove("espn_s2");
                        e.remove("swid");
                        if (priv) e.put("espn_s2", "set");
                    }
                }
                copy.remove("tv");
                return copy.toString();
            } catch (Exception e) {
                return null;
            }
        }
    }

    /** Serves the bundled panel from https://panel.local/ so it has a real origin. */
    private class AssetClient extends WebViewClient {
        private final Map<String, String> types = new HashMap<>();

        AssetClient() {
            types.put("html", "text/html");
            types.put("js", "text/javascript");
            types.put("css", "text/css");
            types.put("json", "application/json");
            types.put("woff2", "font/woff2");
            types.put("png", "image/png");
            types.put("svg", "image/svg+xml");
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            if (!ORIGIN_HOST.equals(req.getUrl().getHost())) return null;
            String path = req.getUrl().getPath();
            if ("/proxy".equals(path)) {
                return proxy(req.getUrl().getQueryParameter("u"), req.getUrl().getQueryParameter("f"));
            }
            if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
            if (path.contains("..")) return notFound();
            String ext = path.substring(path.lastIndexOf('.') + 1);
            try {
                InputStream in = getAssets().open("web" + path);
                WebResourceResponse r = new WebResourceResponse(
                        types.getOrDefault(ext, "application/octet-stream"), "utf-8", in);
                Map<String, String> h = new HashMap<>();
                h.put("Cache-Control", "no-cache");
                r.setResponseHeaders(h);
                return r;
            } catch (IOException e) {
                return notFound();
            }
        }

        /**
         * Fetches score data natively for the page (this runs on a WebView
         * background thread). Only https and only the allowlisted hosts.
         */
        private WebResourceResponse proxy(String target, String filter) {
            HttpURLConnection c = null;
            try {
                URL u = new URL(target);
                if (!"https".equals(u.getProtocol()) || !DATA_HOSTS.contains(u.getHost())) {
                    return error(403, "Forbidden");
                }
                c = (HttpURLConnection) u.openConnection();
                c.setConnectTimeout(10000);
                c.setReadTimeout(20000);
                c.setInstanceFollowRedirects(false);
                c.setRequestProperty("Accept", "application/json");
                if (u.getHost().endsWith("espn.com")) {
                    if (filter != null && filter.length() < 2000) c.setRequestProperty("x-fantasy-filter", filter);
                    String cookie = CookieManager.getInstance().getCookie(target);
                    if (cookie != null) c.setRequestProperty("Cookie", cookie);
                }
                int code = c.getResponseCode();
                InputStream body = code < 400 ? c.getInputStream() : c.getErrorStream();
                Map<String, String> h = new HashMap<>();
                h.put("Cache-Control", "no-store");
                String reason = c.getResponseMessage();
                return new WebResourceResponse("application/json", "utf-8", code,
                        reason == null || reason.isEmpty() ? "OK" : reason, h, body);
            } catch (Exception e) {
                Log.w(TAG, "proxy failed: " + e.getClass().getSimpleName());
                if (c != null) c.disconnect();
                return error(502, "Bad Gateway");
            }
        }

        private WebResourceResponse error(int code, String reason) {
            return new WebResourceResponse("text/plain", "utf-8", code, reason, new HashMap<>(), null);
        }

        private WebResourceResponse notFound() {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), null);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            return true; // the panel never navigates anywhere
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // A crashed or reclaimed renderer must never take the app (or the
            // TV's foreground app) down with it. Just close the panel.
            Log.w(TAG, "renderer gone, closing panel");
            if (view == webView) webView = null;
            destroyView(view);
            stopEverything();
            return true;
        }
    }
}
