'use client';

import { BrowserRouter } from 'react-router-dom';
import App from '../../apps/frontend/src/App';

export default function LegacyTelemedicineRuntime() {
  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}
