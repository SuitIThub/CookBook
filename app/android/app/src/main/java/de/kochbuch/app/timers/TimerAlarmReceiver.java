package de.kochbuch.app.timers;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Fires when a timer ends, dismisses an alarm, and restores timers after a reboot/update. */
public class TimerAlarmReceiver extends BroadcastReceiver {
    static final String ACTION_FIRE = "de.kochbuch.app.TIMER_FIRE";
    static final String ACTION_DISMISS = "de.kochbuch.app.TIMER_DISMISS";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        String id = intent.getStringExtra(TimerNotifications.EXTRA_ID);
        if (ACTION_FIRE.equals(action) && id != null) {
            TimerStore.Timer t = TimerStore.remove(ctx, id);
            if (t != null) TimerNotifications.showAlarm(ctx, t);
            TimerNotifications.refreshOngoing(ctx);
        } else if (ACTION_DISMISS.equals(action) && id != null) {
            TimerNotifications.dismissAlarm(ctx, id);
        } else if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            // Alarms don't survive a reboot or app update: re-register the stored timers.
            TimerNotifications.replaceAll(ctx, TimerStore.load(ctx));
        }
    }
}
