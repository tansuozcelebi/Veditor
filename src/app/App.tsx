import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Clapperboard, LayoutDashboard, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VideoEditor } from '@/features/video-editor';

/**
 * Standalone shell that mimics a host application's sidebar menu (e.g. the WMS front-end):
 * the editor is mounted as a regular route so the same module can be dropped into another app.
 */
export function App() {
  return (
    <BrowserRouter>
      <div className="dark bg-background text-foreground flex h-screen w-screen overflow-hidden">
        <nav className="bg-sidebar text-sidebar-foreground flex w-14 shrink-0 flex-col items-center gap-1 border-r py-3" aria-label="Menü">
          <div className="mb-2 flex size-9 items-center justify-center rounded-md bg-red-600 font-bold text-white" title="Veditor">V</div>
          <MenuLink to="/dashboard" icon={<LayoutDashboard />} label="Panel" />
          <MenuLink to="/video-editor" icon={<Clapperboard />} label="Video Editörü" />
          <MenuLink to="/settings" icon={<Settings />} label="Ayarlar" />
        </nav>
        <div className="min-w-0 flex-1">
          <Routes>
            <Route path="/" element={<Navigate to="/video-editor" replace />} />
            <Route path="/video-editor" element={<VideoEditor embedded />} />
            <Route path="/dashboard" element={<Placeholder title="Panel" />} />
            <Route path="/settings" element={<Placeholder title="Ayarlar" />} />
            <Route path="*" element={<Navigate to="/video-editor" replace />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}

function MenuLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink to={to} title={label} className={({ isActive }) => cn('flex size-10 items-center justify-center rounded-md transition-colors hover:bg-sidebar-accent [&_svg]:size-5', isActive && 'bg-sidebar-accent text-sidebar-primary')}>
      {icon}<span className="sr-only">{label}</span>
    </NavLink>
  );
}

function Placeholder({ title }: { title: string }) {
  return <div className="text-muted-foreground flex h-full items-center justify-center text-sm">{title} – örnek menü sayfası</div>;
}
