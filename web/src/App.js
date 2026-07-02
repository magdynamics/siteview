import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/Login';
import SupervisorDashboard from './pages/supervisor/Dashboard';
import AccountantDashboard from './pages/accountant/Dashboard';
import ManagerDashboard from './pages/manager/Dashboard';
import AdminDashboard from './pages/admin/Dashboard';

function RoleRouter() {
  const { user, profile, loading } = useAuth();

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading SiteView...</div>;
  if (!user) return <Navigate to="/login" />;

  switch (profile?.role) {
    case 'supervisor': return <Navigate to="/supervisor" />;
    case 'accountant': return <Navigate to="/accountant" />;
    case 'manager': return <Navigate to="/manager" />;
    case 'admin': return <Navigate to="/admin" />;
    default: return <div>Access denied. Please contact your administrator.</div>;
  }
}

function ProtectedRoute({ children, roles }) {
  const { user, profile, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" />;
  if (roles && !roles.includes(profile?.role)) return <Navigate to="/" />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RoleRouter />} />
          <Route path="/supervisor/*" element={
            <ProtectedRoute roles={['supervisor', 'admin']}>
              <SupervisorDashboard />
            </ProtectedRoute>
          } />
          <Route path="/accountant/*" element={
            <ProtectedRoute roles={['accountant', 'admin']}>
              <AccountantDashboard />
            </ProtectedRoute>
          } />
          <Route path="/manager/*" element={
            <ProtectedRoute roles={['manager', 'admin']}>
              <ManagerDashboard />
            </ProtectedRoute>
          } />
          <Route path="/admin/*" element={
            <ProtectedRoute roles={['admin']}>
              <AdminDashboard />
            </ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
