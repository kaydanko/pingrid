import { useCallback, useEffect, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { EmptyState } from './components/EmptyState';
import { ResourceEditor } from './components/ResourceEditor';
import { SettingsPanel } from './components/SettingsPanel';
import { DonatePanel } from './components/DonatePanel';
import { TopBar } from './components/TopBar';
import { Toaster } from './components/toast';
import { actions, useApp } from './lib/store';
import { demoResources } from './lib/demo';
import { monitor } from './engine/monitor';
import { useWakeLock } from './hooks/useWakeLock';
import { primeAudio, requestOsPermission } from './platform/notifier';

export default function App() {
  const ready = useApp((s) => s.ready);
  const count = useApp((s) => s.resources.length);
  const theme = useApp((s) => s.settings.theme);
  const lang = useApp((s) => s.settings.lang);
  const osNotify = useApp((s) => s.settings.notify.os);
  const keepAwake = useApp((s) => s.settings.keepAwake);
  const [editor, setEditor] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const wake = useWakeLock(ready && count > 0 && keepAwake);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a0c0f' : '#eceee9');
  }, [theme, lang]);

  useEffect(() => {
    if (!ready) return;
    monitor.start();
    return () => monitor.stop();
  }, [ready]);

  // Audio and notification permission both need a user gesture in browsers.
  useEffect(() => {
    const once = () => {
      primeAudio();
      if (osNotify) void requestOsPermission().catch(() => undefined);
    };
    window.addEventListener('pointerdown', once, { once: true });
    return () => window.removeEventListener('pointerdown', once);
  }, [osNotify]);

  const openEditor = useCallback((id: string | null) => setEditor({ open: true, id }), []);
  const closeEditor = useCallback(() => setEditor((e) => ({ ...e, open: false })), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeDonate = useCallback(() => setDonateOpen(false), []);
  const openDonate = useCallback(() => {
    setSettingsOpen(false);
    setDonateOpen(true);
  }, []);

  if (!ready) return <div className="h-dvh bg-bg" />;

  return (
    <div className="flex h-dvh flex-col overflow-hidden pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <TopBar wake={wake} onAdd={() => openEditor(null)} onSettings={() => setSettingsOpen(true)} onDonate={openDonate} />
      {count === 0 ? (
        <EmptyState onAdd={() => openEditor(null)} onDemo={() => actions.addResources(demoResources(lang))} />
      ) : (
        <Dashboard onEdit={openEditor} />
      )}
      <ResourceEditor open={editor.open} id={editor.id} onClose={closeEditor} />
      <SettingsPanel open={settingsOpen} onClose={closeSettings} onDonate={openDonate} />
      <DonatePanel open={donateOpen} onClose={closeDonate} />
      <Toaster />
    </div>
  );
}
