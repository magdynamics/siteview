import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../context/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import TaskPhotoScreen from '../screens/TaskPhotoScreen';
import DocumentScanScreen from '../screens/DocumentScanScreen';
import EquipmentScreen from '../screens/EquipmentScreen';
import InspectionScreen from '../screens/InspectionScreen';
import MachineHoursScreen from '../screens/MachineHoursScreen';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

function EmployeeTabs() {
  const { t } = useTranslation();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#1a237e',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ tabBarLabel: t('dashboard'), tabBarIcon: () => <Text>🏠</Text> }}
      />
      <Tab.Screen
        name="Tasks"
        component={TaskPhotoScreen}
        options={{ tabBarLabel: t('tasks'), tabBarIcon: () => <Text>📷</Text> }}
      />
      <Tab.Screen
        name="Documents"
        component={DocumentScanScreen}
        options={{ tabBarLabel: t('documents'), tabBarIcon: () => <Text>📄</Text> }}
      />
      <Tab.Screen
        name="Equipment"
        component={EquipmentScreen}
        options={{ tabBarLabel: 'Equipment', tabBarIcon: () => <Text>🔧</Text> }}
      />
      <Tab.Screen
        name="Inspection"
        component={InspectionScreen}
        options={{ tabBarLabel: 'Inspect', tabBarIcon: () => <Text>✅</Text> }}
      />
      <Tab.Screen
        name="Hours"
        component={MachineHoursScreen}
        options={{ tabBarLabel: 'Hours', tabBarIcon: () => <Text>⏱</Text> }}
      />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { user, loading } = useAuth();

  if (loading) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <Stack.Screen name="Main" component={EmployeeTabs} />
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
