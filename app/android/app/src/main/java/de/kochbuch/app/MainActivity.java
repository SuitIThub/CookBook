package de.kochbuch.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import de.kochbuch.app.timers.CookTimersPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShareTargetPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(CookTimersPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
