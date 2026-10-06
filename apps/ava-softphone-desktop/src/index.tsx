import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/animations.css';
import './styles/futuristic.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Lemtel root element is missing.');

const root = createRoot(rootElement);

type StartupFailureProps = { onRetry: () => void };

const workspaceShell: React.CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: 32,
  background: 'radial-gradient(circle at 12% 12%, rgba(0, 186, 255, 0.16), transparent 30%), radial-gradient(circle at 88% 82%, rgba(112, 81, 255, 0.16), transparent 34%), #07152d',
  color: '#f7fbff',
  fontFamily: 'DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
};

function StartupShell() {
  return (
    <main style={workspaceShell} aria-label="Opening Lemtel workspace">
      <section style={{ width: 'min(480px, 100%)', padding: 36, borderRadius: 28, background: 'rgba(9, 29, 63, 0.84)', border: '1px solid rgba(143, 218, 255, 0.24)', boxShadow: '0 24px 80px rgba(0, 0, 0, 0.34)', textAlign: 'center' }}>
        <div aria-hidden="true" style={{ width: 52, height: 52, margin: '0 auto 20px', borderRadius: 16, display: 'grid', placeItems: 'center', color: '#07152d', fontSize: 28, fontWeight: 800, background: 'linear-gradient(135deg, #66e8ff, #a792ff)' }}>L</div>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', color: '#8bdff5', textTransform: 'uppercase' }}>Lemtel workspace</div>
        <h1 style={{ margin: '10px 0 8px', fontSize: 28 }}>Opening secure communications</h1>
        <p style={{ margin: 0, color: 'rgba(238, 247, 255, 0.72)' }}>Preparing your calling, messaging, and AI workspace…</p>
      </section>
    </main>
  );
}

function StartupFailure({ onRetry }: StartupFailureProps) {
  return (
    <main style={workspaceShell} aria-label="Lemtel startup recovery">
      <section style={{ width: 'min(500px, 100%)', padding: 36, borderRadius: 28, background: 'rgba(9, 29, 63, 0.92)', border: '1px solid rgba(255, 206, 80, 0.44)', boxShadow: '0 24px 80px rgba(0, 0, 0, 0.34)', textAlign: 'center' }}>
        <div aria-hidden="true" style={{ width: 52, height: 52, margin: '0 auto 20px', borderRadius: 16, display: 'grid', placeItems: 'center', color: '#1a2137', fontSize: 25, fontWeight: 900, background: 'linear-gradient(135deg, #ffe96f, #ffb84d)' }}>L</div>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', color: '#ffe188', textTransform: 'uppercase' }}>Lemtel recovery</div>
        <h1 style={{ margin: '10px 0 8px', fontSize: 28 }}>The workspace did not finish loading</h1>
        <p style={{ margin: '0 0 22px', color: 'rgba(238, 247, 255, 0.72)' }}>Your account and data are safe. Restart the Lemtel workspace to try again.</p>
        <button type="button" onClick={onRetry} style={{ border: 0, borderRadius: 14, padding: '13px 22px', cursor: 'pointer', color: '#07152d', fontWeight: 800, fontSize: 14, background: 'linear-gradient(135deg, #66e8ff, #a792ff)' }}>Restart Lemtel</button>
      </section>
    </main>
  );
}

function reportBootFailure(error: unknown) {
  const value = error as { message?: string; stack?: string } | undefined;
  const message = String(value?.message || error || 'Unknown renderer startup error');
  // Keep technical details in the local diagnostics only; users see a recovery screen.
  console.error('[lemtel-renderer] startup failed:', message);
  try {
    window.electronAPI?.logRendererCrash?.({
      scope: 'startup-bootstrap',
      message,
      stack: value?.stack,
    });
  } catch { /* diagnostic logging must never hide recovery UI */ }
}

window.addEventListener('unhandledrejection', (event) => {
  reportBootFailure(event.reason);
  event.preventDefault();
});
window.addEventListener('error', (event) => reportBootFailure(event.error || event.message));

root.render(<StartupShell />);

async function mountWorkspace() {
  try {
    // Import application modules only after the recovery shell is mounted.
    // A failed module can therefore never leave a blank Electron window.
    await import('./lib/buildGuard');
    const [
      { default: App },
      { default: MessagesHarness },
      { ThemeProvider },
      { AppErrorBoundary },
      { default: DemoModeBanner },
    ] = await Promise.all([
      import('./App'),
      import('./test-harness/MessagesHarness'),
      import('./lib/theme'),
      import('./components/AppErrorBoundary'),
      import('./components/DemoModeBanner'),
    ]);

    const params = new URLSearchParams(window.location.search);
    const RootComponent = params.get('testHarness') === 'messages' ? MessagesHarness : App;

    root.render(
      <React.StrictMode>
        <AppErrorBoundary>
          <ThemeProvider>
            <DemoModeBanner />
            <RootComponent />
          </ThemeProvider>
        </AppErrorBoundary>
      </React.StrictMode>,
    );
  } catch (error) {
    reportBootFailure(error);
    root.render(<StartupFailure onRetry={() => window.location.reload()} />);
  }
}

void mountWorkspace();
