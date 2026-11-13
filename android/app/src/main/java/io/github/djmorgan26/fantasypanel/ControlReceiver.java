package io.github.djmorgan26.fantasypanel;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;

import java.nio.charset.StandardCharsets;

/**
 * Commands from your computer over adb. Protected by android.permission.DUMP
 * in the manifest, so only the adb shell (or the system) can send them.
 */
public class ControlReceiver extends BroadcastReceiver {
    private static final String P = "io.github.djmorgan26.fantasypanel.";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if (a == null) return;
        switch (a) {
            case P + "CONFIG": {
                String b64 = intent.getStringExtra("b64");
                boolean ok = false;
                if (b64 != null) {
                    try {
                        String json = new String(Base64.decode(b64, Base64.DEFAULT), StandardCharsets.UTF_8);
                        ok = Prefs.save(ctx, json);
                    } catch (IllegalArgumentException e) {
                        ok = false;
                    }
                }
                Log.i(OverlayService.TAG, "config " + (ok ? "saved" : "rejected"));
                setResultCode(ok ? 1 : 0);
                setResultData(ok ? "saved" : "rejected");
                if (ok && OverlayService.isShowing()) OverlayService.send(ctx, OverlayService.ACTION_RELOAD);
                break;
            }
            case P + "SHOW":
                if (Settings.canDrawOverlays(ctx)) OverlayService.send(ctx, OverlayService.ACTION_SHOW, mode(intent));
                break;
            case P + "HIDE":
                OverlayService.send(ctx, OverlayService.ACTION_HIDE);
                break;
            case P + "TOGGLE":
                if (Settings.canDrawOverlays(ctx)) OverlayService.send(ctx, OverlayService.ACTION_TOGGLE, mode(intent));
                break;
            case P + "FOCUS":
                // make tv-focus KEY=...: pin a league ("all" to rotate again).
                Prefs.setFocus(ctx, intent.getStringExtra("key"));
                Log.i(OverlayService.TAG, "focus " + Prefs.focus(ctx));
                OverlayService.send(ctx, OverlayService.ACTION_FOCUS);
                break;
            case P + "RELOAD":
                if (OverlayService.isShowing()) OverlayService.send(ctx, OverlayService.ACTION_RELOAD);
                break;
            default:
                break;
        }
    }

    private static String mode(Intent i) {
        return OverlayService.MODE_MINI.equals(i.getStringExtra("mode")) ? OverlayService.MODE_MINI : OverlayService.MODE_FULL;
    }
}
