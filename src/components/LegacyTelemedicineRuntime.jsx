'use client';

import { BrowserRouter } from 'react-router-dom';
import App from '../../apps/frontend/src/App';

export default function LegacyTelemedicineRuntime() {
  return (
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <App />
    </BrowserRouter>
  );
}
