package io.github.djmorgan26.fantasypanel;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;

/**
 * The app's launcher entry ("Hey Google, open Fantasy Football"). It is
 * translucent and finishes immediately, so whatever you were watching stays
 * in front and keeps playing; it only flips the panel on or off.
 */
public class ToggleActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Settings.canDrawOverlays(this)) {
            OverlayService.send(this, OverlayService.ACTION_TOGGLE);
        } else {
            startActivity(new Intent(this, SetupActivity.class));
        }
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
}
