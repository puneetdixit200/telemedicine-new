'use client';

import dynamic from 'next/dynamic';

const LegacyTelemedicineRuntime = dynamic(() => import('@/components/LegacyTelemedicineRuntime'), {
  ssr: false,
  loading: () => <main aria-label="Loading telemedicine app" />
});

export default function LegacyTelemedicineApp() {
  return <LegacyTelemedicineRuntime />;
}
