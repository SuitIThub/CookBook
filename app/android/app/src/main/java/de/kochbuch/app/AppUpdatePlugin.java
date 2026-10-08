package de.kochbuch.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * In-app update: downloads a release APK (GitHub release asset) into the cache
 * and hands it to the system package installer. The installer asks the user to
 * confirm; the APK must be signed with the same key as the installed app.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    /** Whether the user allowed this app to install packages ("unbekannte Apps"). */
    @PluginMethod
    public void canInstall(PluginCall call) {
        boolean allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.O
            || getContext().getPackageManager().canRequestPackageInstalls();
        JSObject result = new JSObject();
        result.put("allowed", allowed);
        call.resolve(result);
    }

    /** Opens the "install unknown apps" setting for this app. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url required");
            return;
        }
        new Thread(() -> {
            try {
                File apk = download(url);
                install(apk);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }).start();
    }

    private File download(String url) throws IOException {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("Cache-Verzeichnis nicht verfügbar");
        File apk = new File(dir, "kochbuch-update.apk");

        HttpURLConnection conn = open(url);
        // GitHub asset URLs redirect to a CDN host; follow manually (max 5 hops).
        for (int i = 0; i < 5; i++) {
            int code = conn.getResponseCode();
            if (code < 300 || code >= 400) break;
            String next = conn.getHeaderField("Location");
            conn.disconnect();
            if (next == null) throw new IOException("Weiterleitung ohne Ziel");
            conn = open(next);
        }
        int code = conn.getResponseCode();
        if (code >= 400) throw new IOException("Download fehlgeschlagen (HTTP " + code + ")");

        long total = conn.getContentLength();
        long loaded = 0;
        long lastEmit = 0;
        try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                loaded += n;
                long now = System.currentTimeMillis();
                if (now - lastEmit > 250) {
                    lastEmit = now;
                    JSObject progress = new JSObject();
                    progress.put("loaded", loaded);
                    progress.put("total", total);
                    notifyListeners("downloadProgress", progress);
                }
            }
        } finally {
            conn.disconnect();
        }
        return apk;
    }

    private HttpURLConnection open(String url) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(60000);
        conn.setRequestProperty("Accept", "application/octet-stream");
        conn.setRequestProperty("User-Agent", "Kochbuch-App");
        return conn;
    }

    private void install(File apk) {
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }
}
