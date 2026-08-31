import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/** Where each role belongs when it lands somewhere it should not be. */
export const homeFor = (role) =>
  role === 'manager' ? '/manager' : role === 'admin' ? '/admin' : role === 'audit' ? '/finance' : '/';

export default function ProtectedRoute({ children, adminOnly = false, roles = null }) {
  const { user, isAdmin } = useAuth();
  const location = useLocation();

  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (adminOnly && !isAdmin) return <Navigate to={homeFor(user.role)} replace />;
  // `roles` gates a route on an explicit set, e.g. ['admin', 'audit'].
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;

  return children;
}
