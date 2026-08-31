import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Navbar from './components/Navbar.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import LoadingCat from './components/LoadingCat.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import History from './pages/History.jsx';
import Admin from './pages/Admin.jsx';
import TeamReport from './pages/TeamReport.jsx';
import ModeratorManagement from './pages/ModeratorManagement.jsx';
import Schedule from './pages/Schedule.jsx';
import Finance from './pages/Finance.jsx';
import ServerManager from './pages/ServerManager.jsx';
import Profile from './pages/Profile.jsx';

/** Each role lands on its own home; only moderators get the clock-in dashboard. */
function Home() {
  const { user } = useAuth();
  if (user?.role === 'manager') return <Navigate to="/manager" replace />;
  if (user?.role === 'admin') return <Navigate to="/admin" replace />;
  if (user?.role === 'audit') return <Navigate to="/finance" replace />;
  return <Dashboard />;
}

export default function App() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-page" role="status" aria-live="polite">
        <LoadingCat size={120} label="Loading InOut Portal" />
        <div className="loading-text">Loading…</div>
      </div>
    );
  }

  return (
    <>
      <Navbar />
      <main className="container">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route
            path="/history"
            element={
              <ProtectedRoute>
                <History />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute adminOnly>
                <Admin />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/report"
            element={
              <ProtectedRoute adminOnly>
                <TeamReport />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/moderators"
            element={
              <ProtectedRoute adminOnly>
                <ModeratorManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/schedule"
            element={
              <ProtectedRoute adminOnly>
                <Schedule />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance"
            element={
              <ProtectedRoute roles={['audit', 'admin', 'manager']}>
                <Finance />
              </ProtectedRoute>
            }
          />
          <Route
            path="/manager"
            element={
              <ProtectedRoute roles={['manager']}>
                <ServerManager />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
