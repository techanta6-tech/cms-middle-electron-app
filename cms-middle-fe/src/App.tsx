import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import LoginPage from './components/LoginPage';
import { authApi } from './api/authApi';
import { Dashboard } from './components/Dashboard';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  if (!authApi.isAuthenticated()) {
    return <Navigate to={`/login${location.search}`} replace />;
  }
  return <>{children}</>;
};

export default function App() {
  const location = useLocation();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/dashboard"
        element={(
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        )}
      />
      <Route path="*" element={<Navigate to={`/dashboard${location.search}`} replace />} />
    </Routes>
  );
}
