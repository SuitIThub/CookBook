import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'de.kochbuch.app',
  appName: 'Kochbuch',
  webDir: 'dist',
  server: {
    // Serve the WebView from http://localhost (default is https://localhost).
    // The dev/self-hosted API is plain http on the LAN, so an https origin would
    // make every fetch mixed content and get blocked by the WebView. Matching the
    // scheme (http) + usesCleartextTraffic lets the LAN API through.
    // For a production HTTPS server this can go back to the https default.
    androidScheme: 'http'
  }
};

export default config;
