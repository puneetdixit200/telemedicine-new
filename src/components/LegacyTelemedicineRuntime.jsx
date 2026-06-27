'use client';

import { BrowserRouter } from 'react-router-dom';
import App from '../../apps/frontend/src/App';
import MobilePersistentDock from './MobilePersistentDock';

export default function LegacyTelemedicineRuntime() {
  return (
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <App />
      <MobilePersistentDock />
    </BrowserRouter>
  );
}
