import './src/i18n';
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/context/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import { loadSavedLanguage } from './src/i18n';

export default function App() {
  useEffect(() => {
    loadSavedLanguage();
  }, []);

  return (
    <AuthProvider>
      <StatusBar style="light" />
      <AppNavigator />
    </AuthProvider>
  );
}
