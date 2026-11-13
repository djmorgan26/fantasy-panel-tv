package io.github.djmorgan26.fantasypanel;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;

/**
 * The launcher entries. "Fantasy Football" opens the menu (with the panel
 * beside it). "Fantasy Scores" just flips the corner score card on or off:
 * it is translucent and finishes at once, so whatever is playing stays in
 * front and keeps playing.
 */
public class ToggleActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Settings.canDrawOverlays(this)) {
            String cls = getIntent().getComponent() != null ? getIntent().getComponent().getClassName() : "";
            boolean scores = cls.endsWith("ScoresAlias");
            android.util.Log.i(OverlayService.TAG, "launched: " + cls.substring(cls.lastIndexOf('.') + 1)
                    + " from " + getReferrer());
            if (scores) {
                OverlayService.send(this, OverlayService.ACTION_TOGGLE, OverlayService.MODE_MINI);
            } else {
                startActivity(new Intent(this, MenuActivity.class));
            }
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
