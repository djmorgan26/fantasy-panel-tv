package io.github.djmorgan26.fantasypanel;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.util.Log;

import org.json.JSONObject;

/**
 * Opens a game in a streaming app. The page only names a provider and a
 * search phrase; the links are built here, for these apps only, so the page
 * can never open anything else. Each link is that app's own search page,
 * which lists the live game first.
 */
final class Watch {
    private Watch() {}

    private static final String[][] PROVIDERS = {
        // id, package, search link prefix (null: just open the app)
        {"youtubetv", "com.google.android.youtube.tvunplugged", "https://tv.youtube.com/search?q="},
        {"prime", "com.amazon.amazonvideo.livingroom", "https://app.primevideo.com/search?phrase="},
        {"youtube", "com.google.android.youtube.tv", null},
        {"netflix", "com.netflix.ninja", null},
        {"peacock", "com.peacocktv.peacockandroid", null},
        {"paramount", "com.cbs.ott", null},
    };

    private static String[] find(String id) {
        for (String[] p : PROVIDERS) if (p[0].equals(id)) return p;
        return null;
    }

    static boolean installed(Context ctx, String pkg) {
        try {
            ctx.getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    /** {"youtubetv": true, "prime": false, ...} for the menu. */
    static JSONObject installedMap(Context ctx) {
        JSONObject o = new JSONObject();
        for (String[] p : PROVIDERS) {
            try {
                o.put(p[0], installed(ctx, p[1]));
            } catch (Exception ignored) {
                // never happens for a string key
            }
        }
        return o;
    }

    static boolean open(Context ctx, String provider, String query) {
        String[] p = find(provider);
        if (p == null || !installed(ctx, p[1])) return false;
        String q = query == null ? "" : query.replaceAll("[\\p{Cntrl}]", "").trim();
        if (q.length() > 120) q = q.substring(0, 120);
        Intent i = null;
        if (p[2] != null && !q.isEmpty()) {
            i = new Intent(Intent.ACTION_VIEW, Uri.parse(p[2] + Uri.encode(q))).setPackage(p[1]);
        }
        if (i == null || i.resolveActivity(ctx.getPackageManager()) == null) {
            PackageManager pm = ctx.getPackageManager();
            i = pm.getLeanbackLaunchIntentForPackage(p[1]);
            if (i == null) i = pm.getLaunchIntentForPackage(p[1]);
        }
        if (i == null) return false;
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(i);
            Log.i(OverlayService.TAG, "watch: " + provider + " \"" + q + "\"");
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            Log.w(OverlayService.TAG, "watch failed: " + provider, e);
            return false;
        }
    }
}
