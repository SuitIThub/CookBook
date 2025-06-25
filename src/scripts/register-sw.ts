// Register service worker
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker registered with scope:', registration.scope);

      // Listen for service worker state changes
      registration.addEventListener('statechange', (event) => {
        console.log('Service Worker state changed:', (event.target as ServiceWorker).state);
      });

      // Listen for service worker updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            console.log('New Service Worker state:', newWorker.state);
          });
        }
      });

      // Handle service worker communication
      navigator.serviceWorker.addEventListener('message', (event) => {
        console.log('Message from Service Worker:', event.data);
      });

    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  } else {
    console.log('Service Workers are not supported in this browser');
  }
}

// Initialize when the page loads
window.addEventListener('load', registerServiceWorker);

// Export for use in other files
export { registerServiceWorker }; 