import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { useThemeStore } from '@/store/theme';
import Layout from '@/components/Layout/Layout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import ProjectList from '@/pages/Projects/ProjectList';
import ProjectDetail from '@/pages/Projects/ProjectDetail';
import ChatList from '@/pages/Chat/ChatList';
import ChatView from '@/pages/Chat/ChatView';
import CronList from '@/pages/Cron/CronList';
import SystemConfig from '@/pages/System/Config';
import ProviderList from '@/pages/Providers/ProviderList';
import SkillList from '@/pages/Skills/SkillList';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  console.log('[ProtectedRoute] isAuthenticated:', isAuthenticated);
  if (!isAuthenticated) {
    console.log('[ProtectedRoute] Not authenticated, redirecting to /login');
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function LoginRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [searchParams] = useSearchParams();
  console.log('[LoginRoute] isAuthenticated:', isAuthenticated, 'searchParams:', Object.fromEntries(searchParams.entries()));

  if (isAuthenticated) {
    const redirect = searchParams.get('redirect') || '/';
    console.log('[LoginRoute] Already authenticated, redirecting to:', redirect);
    return <Navigate to={redirect} replace />;
  }

  return <Login />;
}

export default function App() {
  const resolved = useThemeStore((s) => s.resolved);
  return (
    <div className={`cc-connect-panel-root${resolved === 'dark' ? ' dark' : ''}`}>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="projects" element={<ProjectList />} />
          <Route path="projects/:name" element={<ProjectDetail />} />
          <Route path="providers" element={<ProviderList />} />
          <Route path="skills" element={<SkillList />} />
          <Route path="chat" element={<ChatList />} />
          <Route path="chat/:name" element={<ChatView />} />
          <Route path="cron" element={<CronList />} />
          <Route path="system" element={<SystemConfig />} />
        </Route>
      </Routes>
    </div>
  );
}

