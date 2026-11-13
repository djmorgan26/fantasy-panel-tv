package io.github.djmorgan26.fantasypanel;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
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
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

/**
 * What the panel and the menu share: the bundled pages served from
 * https://panel.local/, the allowlisted data proxy, ESPN cookies, and the
 * copy of your settings that page script is allowed to see.
 */
final class WebHost {
    static final String ORIGIN_HOST = "panel.local";
    static final String ORIGIN = "https://" + ORIGIN_HOST + "/";
    private static final Set<String> DATA_HOSTS = new HashSet<>(Arrays.asList(
            "api.sleeper.app", "lm-api-reads.fantasy.espn.com", "site.api.espn.com"));

    private WebHost() {}

    /** A WebView set up the same way for the panel and the menu. */
    @SuppressLint("SetJavaScriptEnabled")
    static WebView create(Context ctx, Consumer<WebView> onGone) {
        WebView v = new WebView(ctx);
        v.setBackgroundColor(Color.TRANSPARENT);
        v.setVerticalScrollBarEnabled(false);
        v.setHorizontalScrollBarEnabled(false);
        WebSettings s = v.getSettings();
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
        CookieManager.getInstance().setAcceptThirdPartyCookies(v, true);
        applyCookies(ctx);
        v.setWebViewClient(new Client(ctx, onGone));
        v.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i(OverlayService.TAG, "page: " + m.message());
                return true;
            }
        });
        return v;
    }

    /** ESPN private leagues: hand the user's cookies to the WebView only. */
    static void applyCookies(Context ctx) {
        JSONObject cfg = Prefs.config(ctx);
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

    /** Your settings without the ESPN cookies or the TV address. */
    static String publicConfig(Context ctx) {
        JSONObject cfg = Prefs.config(ctx);
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

    /** Serves the bundled pages from https://panel.local/ so they have a real origin. */
    private static final class Client extends WebViewClient {
        private final Context ctx;
        private final Consumer<WebView> onGone;
        private final Map<String, String> types = new HashMap<>();

        Client(Context ctx, Consumer<WebView> onGone) {
            this.ctx = ctx.getApplicationContext();
            this.onGone = onGone;
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
                InputStream in = ctx.getAssets().open("web" + path);
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
                Log.w(OverlayService.TAG, "proxy failed: " + e.getClass().getSimpleName());
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
            return true; // the pages never navigate anywhere
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // A crashed or reclaimed renderer must never take the app (or the
            // TV's foreground app) down with it. Just close this page.
            Log.w(OverlayService.TAG, "renderer gone, closing");
            onGone.accept(view);
            return true;
        }
    }
}
