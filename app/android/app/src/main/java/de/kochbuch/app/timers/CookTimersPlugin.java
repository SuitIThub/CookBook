package de.kochbuch.app.timers;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/**
 * Bridge for the cooking timers: the web layer sends the set of running timers
 * (with their end time); Android schedules exact alarms and keeps a countdown
 * notification, so timers keep working when the app is minimized or closed.
 */
@CapacitorPlugin(
    name = "CookTimers",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class CookTimersPlugin extends Plugin {

    @Override
    public void load() {
        TimerNotifications.ensureChannels(getContext());
    }

    /** sync({ timers: [{ id, label, body, endsAt }] }) — the complete set of running timers. */
    @PluginMethod
    public void sync(PluginCall call) {
        JSArray arr = call.getArray("timers", new JSArray());
        List<TimerStore.Timer> timers = new ArrayList<>();
        try {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                timers.add(new TimerStore.Timer(o.getString("id"), o.optString("label", "Timer"), o.optString("body", ""), o.getLong("endsAt")));
            }
        } catch (Exception e) {
            call.reject("invalid timers: " + e.getMessage());
            return;
        }
        TimerNotifications.replaceAll(getContext(), timers);
        call.resolve();
    }

    /** Silence/remove the alarm notification of a timer the user handled in the app. */
    @PluginMethod
    public void dismiss(PluginCall call) {
        String id = call.getString("id");
        if (id != null) TimerNotifications.dismissAlarm(getContext(), id);
        call.resolve();
    }

    @PluginMethod
    public void ensurePermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            resolveGranted(call, true);
        } else {
            requestPermissionForAlias("notifications", call, "permissionCallback");
        }
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        resolveGranted(call, getPermissionState("notifications") == PermissionState.GRANTED);
    }

    private void resolveGranted(PluginCall call, boolean granted) {
        JSObject r = new JSObject();
        r.put("granted", granted);
        call.resolve(r);
    }
}
