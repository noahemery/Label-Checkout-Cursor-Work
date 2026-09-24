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
    <AppDataProvider>
      <SettingsProvider>
        <SheetPageProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </SheetPageProvider>
      </SettingsProvider>
    </AppDataProvider>
  </StrictMode>,
);
