package de.kochbuch.app;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Android counterpart of the website's Web Share Target (/share-target): text
 * shared to the app via ACTION_SEND is kept until the web layer takes it with
 * consume(). A "shared" event tells an already running app to call consume().
 */
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {
    private JSObject pending;

    @Override
    public void load() {
        capture(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (capture(intent)) notifyListeners("shared", new JSObject());
    }

    private boolean capture(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return false;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        String title = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        // Handled once: an activity re-creation must not replay the share.
        intent.setAction(Intent.ACTION_MAIN);
        if (text == null && title == null) return false;
        JSObject share = new JSObject();
        share.put("text", text);
        share.put("title", title);
        pending = share;
        return true;
    }

    @PluginMethod
    public void consume(PluginCall call) {
        JSObject result = new JSObject();
        if (pending != null) result.put("share", pending);
        pending = null;
        call.resolve(result);
    }
}
