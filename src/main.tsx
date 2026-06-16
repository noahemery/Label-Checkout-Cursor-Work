import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';
import App from './App';
import { SettingsProvider } from './config/SettingsContext';
import { AppDataProvider } from './data/AppDataContext';
import { SheetPageProvider } from './data/SheetPageContext';
import { SessionProvider } from './session/SessionContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <AppDataProvider>
        <SheetPageProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </SheetPageProvider>
      </AppDataProvider>
    </SettingsProvider>
  </StrictMode>,
);
