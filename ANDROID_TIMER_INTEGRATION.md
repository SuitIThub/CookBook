# Android Timer Integration Guide

This guide explains how to integrate timer functionality from the CookBook web app into your Android companion app.

## Timer Types

The application has two types of timers:

1. **Global Timers**: Stored in the server database, synced across all devices/sessions
2. **Local Timers**: Stored in the browser's localStorage, specific to each WebView instance

## API Endpoints

### Global Timers

**GET `/api/timers`**
- Returns all active global timers
- Response format:
```json
[
  {
    "id": "string",
    "label": "string",
    "duration": 3600,
    "remaining": 1800,
    "isRunning": true,
    "isCompleted": false,
    "recipeName": "string (optional)",
    "stepDescription": "string (optional)",
    "recipeId": "string (optional)",
    "stepId": "string (optional)",
    "startTime": 1234567890,
    "pauseTime": null
  }
]
```

**Note**: When a timer is running, you need to calculate the current remaining time:
```java
if (timer.isRunning && timer.startTime != null) {
    long elapsed = (System.currentTimeMillis() - timer.startTime) / 1000;
    int currentRemaining = Math.max(0, timer.remaining - (int)elapsed);
}
```

## Android Implementation (Java)

### 1. Timer Model Class

Create a `Timer` class to represent timer data:

```java
import com.google.gson.annotations.SerializedName;

public class Timer {
    @SerializedName("id")
    private String id;
    
    @SerializedName("label")
    private String label;
    
    @SerializedName("duration")
    private int duration; // in seconds
    
    @SerializedName("remaining")
    private int remaining; // in seconds
    
    @SerializedName("isRunning")
    private boolean isRunning;
    
    @SerializedName("isCompleted")
    private boolean isCompleted;
    
    @SerializedName("isGlobal")
    private Boolean isGlobal;
    
    @SerializedName("recipeName")
    private String recipeName;
    
    @SerializedName("stepDescription")
    private String stepDescription;
    
    @SerializedName("recipeId")
    private String recipeId;
    
    @SerializedName("stepId")
    private String stepId;
    
    @SerializedName("startTime")
    private Long startTime; // Unix timestamp in milliseconds
    
    @SerializedName("pauseTime")
    private Long pauseTime;
    
    // Constructors
    public Timer() {}
    
    // Getters and Setters
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    
    public String getLabel() { return label; }
    public void setLabel(String label) { this.label = label; }
    
    public int getDuration() { return duration; }
    public void setDuration(int duration) { this.duration = duration; }
    
    public int getRemaining() { return remaining; }
    public void setRemaining(int remaining) { this.remaining = remaining; }
    
    public boolean isRunning() { return isRunning; }
    public void setRunning(boolean running) { isRunning = running; }
    
    public boolean isCompleted() { return isCompleted; }
    public void setCompleted(boolean completed) { isCompleted = completed; }
    
    public Boolean getIsGlobal() { return isGlobal; }
    public void setIsGlobal(Boolean isGlobal) { this.isGlobal = isGlobal; }
    
    public String getRecipeName() { return recipeName; }
    public void setRecipeName(String recipeName) { this.recipeName = recipeName; }
    
    public String getStepDescription() { return stepDescription; }
    public void setStepDescription(String stepDescription) { this.stepDescription = stepDescription; }
    
    public String getRecipeId() { return recipeId; }
    public void setRecipeId(String recipeId) { this.recipeId = recipeId; }
    
    public String getStepId() { return stepId; }
    public void setStepId(String stepId) { this.stepId = stepId; }
    
    public Long getStartTime() { return startTime; }
    public void setStartTime(Long startTime) { this.startTime = startTime; }
    
    public Long getPauseTime() { return pauseTime; }
    public void setPauseTime(Long pauseTime) { this.pauseTime = pauseTime; }
    
    /**
     * Calculate the current remaining time for a running timer
     */
    public int getCurrentRemaining() {
        if (!isRunning || startTime == null) {
            return remaining;
        }
        long elapsed = (System.currentTimeMillis() - startTime) / 1000;
        return Math.max(0, remaining - (int)elapsed);
    }
    
    /**
     * Get the time when this timer will complete (if running)
     */
    public Long getCompletionTime() {
        if (!isRunning || startTime == null) {
            return null;
        }
        return startTime + (remaining * 1000L);
    }
}
```

### 2. API Service for Global Timers

```java
import retrofit2.Call;
import retrofit2.Retrofit;
import retrofit2.converter.gson.GsonConverterFactory;
import retrofit2.http.GET;
import java.util.List;

public interface TimerApiService {
    @GET("api/timers")
    Call<List<Timer>> getGlobalTimers();
}

public class TimerRepository {
    private TimerApiService apiService;
    
    public TimerRepository(String baseUrl) {
        Retrofit retrofit = new Retrofit.Builder()
            .baseUrl(baseUrl)
            .addConverterFactory(GsonConverterFactory.create())
            .build();
        
        apiService = retrofit.create(TimerApiService.class);
    }
    
    public void fetchGlobalTimers(TimerCallback callback) {
        apiService.getGlobalTimers().enqueue(new retrofit2.Callback<List<Timer>>() {
            @Override
            public void onResponse(Call<List<Timer>> call, retrofit2.Response<List<Timer>> response) {
                if (response.isSuccessful() && response.body() != null) {
                    // Calculate current remaining time for running timers
                    long currentTime = System.currentTimeMillis();
                    for (Timer timer : response.body()) {
                        if (timer.isRunning() && timer.getStartTime() != null) {
                            long elapsed = (currentTime - timer.getStartTime()) / 1000;
                            timer.setRemaining(Math.max(0, timer.getRemaining() - (int)elapsed));
                        }
                    }
                    callback.onSuccess(response.body());
                } else {
                    callback.onError(new Exception("Failed to fetch timers"));
                }
            }
            
            @Override
            public void onFailure(Call<List<Timer>> call, Throwable t) {
                callback.onError(t);
            }
        });
    }
    
    public interface TimerCallback {
        void onSuccess(List<Timer> timers);
        void onError(Throwable error);
    }
}
```

### 3. JavaScript Interface for Local Timers

Add a JavaScript interface to your WebView to expose local timers:

```java
import android.content.Context;
import android.util.Log;
import android.webkit.JavascriptInterface;
import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import java.lang.reflect.Type;
import java.util.List;

public class TimerJavaScriptInterface {
    private Context context;
    private TimerCallback callback;
    
    public TimerJavaScriptInterface(Context context, TimerCallback callback) {
        this.context = context;
        this.callback = callback;
    }
    
    @JavascriptInterface
    public void onLocalTimersReceived(String json) {
        try {
            Gson gson = new Gson();
            Type timerListType = new TypeToken<List<Timer>>(){}.getType();
            List<Timer> timers = gson.fromJson(json, timerListType);
            callback.onTimersReceived(timers);
        } catch (Exception e) {
            Log.e("TimerJS", "Error parsing local timers", e);
        }
    }
    
    @JavascriptInterface
    public void onAllTimersReceived(String json) {
        try {
            Gson gson = new Gson();
            Type timerListType = new TypeToken<List<Timer>>(){}.getType();
            List<Timer> timers = gson.fromJson(json, timerListType);
            callback.onTimersReceived(timers);
        } catch (Exception e) {
            Log.e("TimerJS", "Error parsing timers", e);
        }
    }
    
    public interface TimerCallback {
        void onTimersReceived(List<Timer> timers);
    }
}
```

### 4. MainActivity Setup

```java
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private TimerRepository timerRepository;
    private Handler handler;
    private Runnable timerFetchRunnable;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        
        webView = findViewById(R.id.webView);
        timerRepository = new TimerRepository("https://your-app-url.com/");
        handler = new Handler(Looper.getMainLooper());
        
        setupWebView();
        setupTimerFetching();
    }
    
    private void setupWebView() {
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true); // Important for localStorage
        
        // Add JavaScript interface
        TimerJavaScriptInterface jsInterface = new TimerJavaScriptInterface(
            this,
            this::handleLocalTimers
        );
        webView.addJavascriptInterface(jsInterface, "AndroidTimerInterface");
        
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectTimerFetchScript();
            }
        });
        
        webView.loadUrl("https://your-app-url.com/");
    }
    
    private void injectTimerFetchScript() {
        String script = "(function() {" +
            "try {" +
            "  const localTimersJson = localStorage.getItem('active-timers');" +
            "  const localTimers = localTimersJson ? JSON.parse(localTimersJson) : [];" +
            "  fetch('/api/timers')" +
            "    .then(response => response.json())" +
            "    .then(globalTimers => {" +
            "      const allTimers = [...localTimers, ...globalTimers.map(t => ({...t, isGlobal: true}))];" +
            "      const currentTime = Date.now();" +
            "      const processedTimers = allTimers.map(timer => {" +
            "        if (timer.isRunning && timer.startTime) {" +
            "          const elapsed = Math.floor((currentTime - timer.startTime) / 1000);" +
            "          timer.remaining = Math.max(0, timer.remaining - elapsed);" +
            "        }" +
            "        return timer;" +
            "      });" +
            "      AndroidTimerInterface.onAllTimersReceived(JSON.stringify(processedTimers));" +
            "    })" +
            "    .catch(error => {" +
            "      console.error('Error fetching timers:', error);" +
            "      AndroidTimerInterface.onAllTimersReceived(JSON.stringify(localTimers));" +
            "    });" +
            "} catch (e) {" +
            "  console.error('Error:', e);" +
            "  AndroidTimerInterface.onAllTimersReceived('[]');" +
            "}" +
            "})();";
        
        webView.evaluateJavascript(script, null);
    }
    
    private void setupTimerFetching() {
        timerFetchRunnable = new Runnable() {
            @Override
            public void run() {
                fetchAllTimers();
                handler.postDelayed(this, 10000); // Fetch every 10 seconds
            }
        };
        handler.post(timerFetchRunnable);
    }
    
    private void fetchAllTimers() {
        // Fetch global timers
        timerRepository.fetchGlobalTimers(new TimerRepository.TimerCallback() {
            @Override
            public void onSuccess(List<Timer> timers) {
                handleGlobalTimers(timers);
            }
            
            @Override
            public void onError(Throwable error) {
                Log.e("TimerFetch", "Error fetching global timers", error);
            }
        });
        
        // Fetch local timers via JavaScript
        injectTimerFetchScript();
    }
    
    private void handleGlobalTimers(List<Timer> timers) {
        List<Timer> activeTimers = new ArrayList<>();
        for (Timer timer : timers) {
            if (!timer.isCompleted()) {
                activeTimers.add(timer);
            }
        }
        setupBackgroundService(activeTimers);
    }
    
    private void handleLocalTimers(List<Timer> timers) {
        List<Timer> activeTimers = new ArrayList<>();
        for (Timer timer : timers) {
            if (!timer.isCompleted()) {
                activeTimers.add(timer);
            }
        }
        setupBackgroundService(activeTimers);
    }
    
    private void setupBackgroundService(List<Timer> timers) {
        Intent intent = new Intent(this, TimerService.class);
        intent.putParcelableArrayListExtra("timers", new ArrayList<>(timers));
        startService(intent);
    }
    
    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (handler != null && timerFetchRunnable != null) {
            handler.removeCallbacks(timerFetchRunnable);
        }
    }
}
```

### 5. Background Service

```java
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;
import java.util.List;

public class TimerService extends Service {
    private NotificationManager notificationManager;
    
    @Override
    public void onCreate() {
        super.onCreate();
        notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    }
    
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            List<Timer> timers = intent.getParcelableArrayListExtra("timers");
            if (timers != null) {
                for (Timer timer : timers) {
                    if (timer.isRunning() && timer.getCompletionTime() != null) {
                        scheduleTimerNotification(timer);
                    }
                }
            }
        }
        return START_STICKY;
    }
    
    private void scheduleTimerNotification(Timer timer) {
        Long completionTime = timer.getCompletionTime();
        if (completionTime == null) return;
        
        AlarmManager alarmManager = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        Intent intent = new Intent(this, TimerReceiver.class);
        intent.putExtra("timer_id", timer.getId());
        intent.putExtra("timer_label", timer.getLabel());
        
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            this,
            timer.getId().hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        
        alarmManager.setExactAndAllowWhileIdle(
            AlarmManager.RTC_WAKEUP,
            completionTime,
            pendingIntent
        );
    }
    
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
```

## Important Notes

1. **Timer Time Calculation**: Always calculate the current remaining time when fetching timers, especially for running timers using `startTime`.

2. **Local Timers**: Local timers are stored in the WebView's localStorage. Each WebView instance has its own localStorage, so timers are specific to that WebView.

3. **Polling Frequency**: Consider polling every 5-10 seconds for active timers. For background services, you might want to fetch less frequently (every 30-60 seconds).

4. **Permissions**: Make sure your Android app has the necessary permissions for background services and notifications:
   ```xml
   <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
   <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
   <uses-permission android:name="android.permission.USE_EXACT_ALARM" />
   ```

5. **Base URL**: Replace `"https://your-app-url.com/"` with your actual application URL.

6. **Gson Setup**: Make sure to add Gson to your dependencies:
   ```gradle
   implementation 'com.google.code.gson:gson:2.10.1'
   implementation 'com.squareup.retrofit2:retrofit:2.9.0'
   implementation 'com.squareup.retrofit2:converter-gson:2.9.0'
   ```

## Alternative: Using JavaScript Interface for Both

If you prefer to get all timers (including local) via JavaScript injection, you can modify the script to return both:

```javascript
(function() {
    // Get local timers
    const localTimersJson = localStorage.getItem('active-timers');
    const localTimers = localTimersJson ? JSON.parse(localTimersJson) : [];
    
    // Fetch global timers via fetch API
    fetch('/api/timers')
        .then(response => response.json())
        .then(globalTimers => {
            const allTimers = [...localTimers, ...globalTimers.map(t => ({...t, isGlobal: true}))];
            const currentTime = Date.now();
            const processedTimers = allTimers.map(timer => {
                if (timer.isRunning && timer.startTime) {
                    const elapsed = Math.floor((currentTime - timer.startTime) / 1000);
                    timer.remaining = Math.max(0, timer.remaining - elapsed);
                }
                return timer;
            });
            AndroidTimerInterface.onAllTimersReceived(JSON.stringify(processedTimers));
        })
        .catch(error => {
            console.error('Error fetching timers:', error);
            AndroidTimerInterface.onAllTimersReceived(JSON.stringify(localTimers));
        });
})();
```

This approach fetches both local and global timers in a single JavaScript call.

**Note**: Make sure your `Timer` class implements `Parcelable` if you want to pass it via Intent extras. Alternatively, you can serialize it to JSON and pass it as a String.

