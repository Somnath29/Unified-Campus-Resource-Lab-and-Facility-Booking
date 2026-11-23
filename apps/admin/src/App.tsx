import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AdminLayout } from './components/layout/AdminLayout';
import { AnalyticsDashboard } from './pages/AnalyticsDashboard';
import { ResourceManagement } from './pages/ResourceManagement';
import { UserManagement } from './pages/UserManagement';
import { PolicyManagement } from './pages/PolicyManagement';
import { AuditLogs } from './pages/AuditLogs';
import { Login } from './pages/Login';
import { getAdminToken } from './lib/api';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = getAdminToken();
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <AdminLayout>
                <Routes>
                  <Route path="/" element={<AnalyticsDashboard />} />
                  <Route path="/resources" element={<ResourceManagement />} />
                  <Route path="/users" element={<UserManagement />} />
                  <Route path="/policies" element={<PolicyManagement />} />
                  <Route path="/audit" element={<AuditLogs />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AdminLayout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
