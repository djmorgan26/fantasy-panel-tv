package io.github.djmorgan26.fantasypanel;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Explains the one missing step. Press Back to leave. */
public class SetupActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_VERTICAL);
        root.setBackgroundColor(Color.rgb(14, 14, 16));
        int pad = dp(96);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText(R.string.setup_title);
        title.setTextColor(Color.WHITE);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 30);

        TextView body = new TextView(this);
        body.setText(R.string.setup_body);
        body.setTextColor(Color.argb(160, 235, 235, 245));
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        body.setLineSpacing(0, 1.3f);
        body.setPadding(0, dp(16), 0, 0);

        root.addView(title);
        root.addView(body);
        setContentView(root);
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }
}
