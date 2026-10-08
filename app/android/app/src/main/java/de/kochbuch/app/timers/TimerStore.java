package de.kochbuch.app.timers;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Running cooking timers, persisted so alarms survive app death and reboots. */
public final class TimerStore {
    public static final class Timer {
        public final String id;
        public final String label;
        public final String body;
        public final long endsAt;

        public Timer(String id, String label, String body, long endsAt) {
            this.id = id;
            this.label = label;
            this.body = body;
            this.endsAt = endsAt;
        }

        /** Stable int key for PendingIntents / notification ids. */
        public int key() {
            return 0x71000000 | (id.hashCode() & 0x00FFFFFF);
        }
    }

    private static final String PREFS = "kochbuch_cook_timers";
    private static final String KEY = "timers";

    private TimerStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static synchronized List<Timer> load(Context ctx) {
        List<Timer> out = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(prefs(ctx).getString(KEY, "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                out.add(new Timer(o.getString("id"), o.optString("label"), o.optString("body"), o.getLong("endsAt")));
            }
        } catch (Exception ignored) {
            // corrupt -> treat as empty
        }
        return out;
    }

    public static synchronized void save(Context ctx, List<Timer> timers) {
        JSONArray arr = new JSONArray();
        try {
            for (Timer t : timers) {
                JSONObject o = new JSONObject();
                o.put("id", t.id);
                o.put("label", t.label);
                o.put("body", t.body);
                o.put("endsAt", t.endsAt);
                arr.put(o);
            }
        } catch (Exception ignored) {
            // cannot happen for these value types
        }
        prefs(ctx).edit().putString(KEY, arr.toString()).apply();
    }

    public static synchronized Timer remove(Context ctx, String id) {
        Timer removed = null;
        List<Timer> rest = new ArrayList<>();
        for (Timer t : load(ctx)) {
            if (t.id.equals(id)) removed = t;
            else rest.add(t);
        }
        save(ctx, rest);
        return removed;
    }
}
