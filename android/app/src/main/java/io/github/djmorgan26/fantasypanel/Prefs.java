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

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }
}
