import { MemoryRouter } from 'react-router-dom';
import { SideNav } from '../components/SideNav';
import { AppRoutes } from './routes';

/**
 * Top-level layout: fixed-width side nav on the left, scrollable main area on
 * the right. MemoryRouter (not BrowserRouter) avoids history-API quirks when
 * the Electron renderer loads from `file://`.
 */
export function App(): JSX.Element {
  return (
    <MemoryRouter initialEntries={['/briefing']}>
      <div
        style={{
          display: 'flex',
          height: '100vh',
          width: '100vw',
          backgroundColor: 'var(--aria-bg)',
          color: 'var(--aria-fg)',
        }}
      >
        <SideNav />
        <main
          style={{
            flex: '1 1 auto',
            overflowY: 'auto',
            minWidth: 0,
          }}
        >
          <AppRoutes />
        </main>
      </div>
    </MemoryRouter>
  );
}
