import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { PrefsProvider } from './context/PrefsContext.jsx';
import { LiveProvider } from './context/LiveContext.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Prefs sit inside Auth: personalization is stored per account, so the
        provider needs to know who is signed in. */}
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <PrefsProvider>
            {/* Live sits inside Auth too: the stream is authenticated, and it
                opens and closes with the session. */}
            <LiveProvider>
              <App />
            </LiveProvider>
          </PrefsProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
