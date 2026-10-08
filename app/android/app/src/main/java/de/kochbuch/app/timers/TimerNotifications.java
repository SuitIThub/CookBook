package de.kochbuch.app.timers;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import de.kochbuch.app.MainActivity;
import de.kochbuch.app.R;
import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;

/** Alarms + notifications for cooking timers (works with the app closed). */
public final class TimerNotifications {
    static final String CHANNEL_RUNNING = "cook_timers_running";
    static final String CHANNEL_ALARM = "cook_timers_alarm";
    static final int ONGOING_ID = 0x70000001;
    static final String EXTRA_ID = "timerId";
    private static final long[] VIBRATION = { 0, 600, 300, 600, 300, 600 };

    private TimerNotifications() {}

    static int immutable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
    }

    public static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        NotificationChannel running = new NotificationChannel(CHANNEL_RUNNING, "Laufende Timer", NotificationManager.IMPORTANCE_LOW);
        running.setDescription("Countdown der laufenden Koch-Timer");
        running.setShowBadge(false);
        nm.createNotificationChannel(running);

        NotificationChannel alarm = new NotificationChannel(CHANNEL_ALARM, "Timer-Alarm", NotificationManager.IMPORTANCE_HIGH);
        alarm.setDescription("Alarm, wenn ein Koch-Timer abgelaufen ist");
        alarm.enableVibration(true);
        alarm.setVibrationPattern(VIBRATION);
        alarm.setSound(alarmSound(), new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        alarm.setBypassDnd(true);
        nm.createNotificationChannel(alarm);
    }

    static Uri alarmSound() {
        Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        return uri != null ? uri : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
    }

    static PendingIntent openApp(Context ctx, int requestCode) {
        Intent intent = new Intent(ctx, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | immutable());
    }

    private static PendingIntent alarmIntent(Context ctx, TimerStore.Timer t, int flags) {
        Intent intent = new Intent(ctx, TimerAlarmReceiver.class);
        intent.setAction(TimerAlarmReceiver.ACTION_FIRE);
        intent.putExtra(EXTRA_ID, t.id);
        return PendingIntent.getBroadcast(ctx, t.key(), intent, flags | immutable());
    }

    /** Replace all scheduled timers with `timers` (cancels the alarms of the previous set). */
    public static void replaceAll(Context ctx, List<TimerStore.Timer> timers) {
        for (TimerStore.Timer old : TimerStore.load(ctx)) cancelAlarm(ctx, old);
        long now = System.currentTimeMillis();
        List<TimerStore.Timer> pending = new ArrayList<>();
        for (TimerStore.Timer t : timers) {
            if (t.endsAt <= now) showAlarm(ctx, t); // ended while nothing was scheduled (e.g. reboot)
            else pending.add(t);
        }
        TimerStore.save(ctx, pending);
        for (TimerStore.Timer t : pending) scheduleAlarm(ctx, t);
        refreshOngoing(ctx);
    }

    static void scheduleAlarm(Context ctx, TimerStore.Timer t) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = alarmIntent(ctx, t, PendingIntent.FLAG_UPDATE_CURRENT);
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
        if (exact) {
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(t.endsAt, openApp(ctx, t.key())), pi);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t.endsAt, pi);
        } else {
            am.set(AlarmManager.RTC_WAKEUP, t.endsAt, pi);
        }
    }

    static void cancelAlarm(Context ctx, TimerStore.Timer t) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = alarmIntent(ctx, t, PendingIntent.FLAG_NO_CREATE);
        if (pi != null) {
            am.cancel(pi);
            pi.cancel();
        }
    }

    /** "Timer abgelaufen" — the alarm sound repeats until the notification is handled. */
    static void showAlarm(Context ctx, TimerStore.Timer t) {
        ensureChannels(ctx);
        Intent stop = new Intent(ctx, TimerAlarmReceiver.class);
        stop.setAction(TimerAlarmReceiver.ACTION_DISMISS);
        stop.putExtra(EXTRA_ID, t.id);
        PendingIntent stopPi = PendingIntent.getBroadcast(ctx, t.key() ^ 0x1, stop, PendingIntent.FLAG_UPDATE_CURRENT | immutable());

        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_ALARM)
            .setSmallIcon(R.drawable.ic_stat_kochbuch)
            .setContentTitle("Timer abgelaufen: " + t.label)
            .setContentText(t.body != null && !t.body.isEmpty() ? t.body : "Die Zeit ist um!")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setSound(alarmSound(), AudioManager.STREAM_ALARM)
            .setVibrate(VIBRATION)
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx, t.key()))
            .setDeleteIntent(stopPi)
            .addAction(0, "Stopp", stopPi)
            .build();
        n.flags |= Notification.FLAG_INSISTENT;
        try {
            NotificationManagerCompat.from(ctx).notify(t.key(), n);
        } catch (SecurityException ignored) {
            // notification permission denied
        }
    }

    static void dismissAlarm(Context ctx, String id) {
        NotificationManagerCompat.from(ctx).cancel(new TimerStore.Timer(id, "", "", 0).key());
    }

    /** Persistent "Timer läuft" notification with a live countdown to the next timer. */
    public static void refreshOngoing(Context ctx) {
        ensureChannels(ctx);
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        long now = System.currentTimeMillis();
        List<TimerStore.Timer> running = new ArrayList<>();
        for (TimerStore.Timer t : TimerStore.load(ctx)) if (t.endsAt > now) running.add(t);
        if (running.isEmpty()) {
            nm.cancel(ONGOING_ID);
            return;
        }
        Collections.sort(running, (a, b) -> Long.compare(a.endsAt, b.endsAt));
        TimerStore.Timer next = running.get(0);
        DateFormat time = DateFormat.getTimeInstance(DateFormat.SHORT);
        String title = running.size() == 1 ? "Timer läuft: " + next.label : running.size() + " Timer laufen";
        NotificationCompat.InboxStyle inbox = new NotificationCompat.InboxStyle().setBigContentTitle(title);
        String firstLine = null;
        for (TimerStore.Timer t : running) {
            String line = t.label + " – fertig um " + time.format(new Date(t.endsAt));
            inbox.addLine(line);
            if (firstLine == null) firstLine = line;
        }

        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_RUNNING)
            .setSmallIcon(R.drawable.ic_stat_kochbuch)
            .setContentTitle(title)
            .setContentText(firstLine)
            .setStyle(inbox)
            .setWhen(next.endsAt)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setContentIntent(openApp(ctx, ONGOING_ID))
            .build();
        try {
            nm.notify(ONGOING_ID, n);
        } catch (SecurityException ignored) {
            // notification permission denied
        }
    }
}
