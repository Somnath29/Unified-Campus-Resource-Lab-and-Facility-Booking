import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AdminLayout } from './components/layout/AdminLayout';
import { AnalyticsDashboard } from './pages/AnalyticsDashboard';
import { ResourceManagement } from './pages/ResourceManagement';
import { UserManagement } from './pages/UserManagement';
import { PolicyManagement } from './pages/PolicyManagement';
import { AuditLogs } from './pages/AuditLogs';

export function App() {
  return (
    <BrowserRouter>
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
    </BrowserRouter>
  );
}

export default App;

