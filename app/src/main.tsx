import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    // networkMode 'always': most queries read the LOCAL replica, so they must
    // keep running while the device is offline. The default ('online') pauses
    // every query when navigator.onLine is false, freezing the whole UI after
    // an offline edit. Online-only queries (tracker) just fail and show their
    // error state instead.
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false, networkMode: 'always' },
    mutations: { networkMode: 'always' }
  }
});

// Note: intentionally not wrapping in <React.StrictMode>. Its double-invoke of
// effects re-runs data-mutating bootstrap/sync flows twice, which corrupts the
// local replica state. Re-add once effects are side-effect-free.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </QueryClientProvider>
);
