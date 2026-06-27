'use client';

import { Link, useLocation } from 'react-router-dom';
import styles from './MobilePersistentDock.module.css';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Home', icon: 'home' },
  { to: '/appointments', label: 'Visits', icon: 'calendar_today' },
  { to: '/ai-copilot', label: 'AI Help', icon: 'support_agent' },
  { to: '/profile', label: 'Profile', icon: 'person' }
];

const PUBLIC_PATHS = new Set([
  '/',
  '/auth/login',
  '/auth/register',
  '/privacy-policy',
  '/terms-of-service',
  '/help-center'
]);

function isProtectedPath(pathname) {
  if (PUBLIC_PATHS.has(pathname)) return false;
  if (pathname.startsWith('/auth/')) return false;
  return true;
}

function isActive(pathname, target) {
  if (target === '/dashboard') return pathname === '/dashboard';
  if (target === '/appointments') {
    return (
      pathname === '/appointments' ||
      pathname.startsWith('/appointments/') ||
      pathname.startsWith('/calls/') ||
      pathname.startsWith('/prescriptions/')
    );
  }
  if (target === '/profile') return pathname === '/profile' || pathname === '/users/me';
  return pathname === target;
}

export default function MobilePersistentDock() {
  const { pathname } = useLocation();

  if (!isProtectedPath(pathname)) return null;

  return (
    <nav className={styles.dock} aria-label="Mobile primary navigation">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.to}
          className={`${styles.link} ${isActive(pathname, item.to) ? styles.active : ''}`}
          to={item.to}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            {item.icon}
          </span>
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
