package io.github.djmorgan26.fantasypanel;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

/** Your league settings, stored privately on the TV. Sent over adb only. */
final class Prefs {
    private static final String FILE = "panel";
    private static final String KEY = "config";

    private Prefs() {}

    static JSONObject config(Context ctx) {
        String raw = prefs(ctx).getString(KEY, null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }

    static boolean save(Context ctx, String json) {
        try {
            JSONObject o = new JSONObject(json);
            if (!o.has("sleeper") && !o.has("espn")) return false;
            return prefs(ctx).edit().putString(KEY, o.toString()).commit();
        } catch (Exception e) {
            return false;
        }
    }

    /** Which league the panel shows: "all" (rotate) or one matchup key. */
    static String focus(Context ctx) {
        return prefs(ctx).getString("focus", "all");
    }

    static void setFocus(Context ctx, String key) {
        if (key == null || key.isEmpty() || key.length() > 200) key = "all";
        prefs(ctx).edit().putString("focus", key).apply();
    }

    /** The layout you used last: "full" (side panel) or "mini" (score card). */
    static String mode(Context ctx) {
        return OverlayService.MODE_MINI.equals(prefs(ctx).getString("mode", null))
                ? OverlayService.MODE_MINI : OverlayService.MODE_FULL;
    }

    static void setMode(Context ctx, String mode) {
        prefs(ctx).edit().putString("mode", mode).apply();
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }
}
