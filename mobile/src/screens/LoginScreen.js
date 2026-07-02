import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      Alert.alert('Login Failed', 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <Text style={styles.company}>BUILD CHAIN</Text>
        <Text style={styles.appName}>SITE VIEW</Text>

        <TextInput
          style={styles.input}
          placeholder={t('email')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder={t('password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{t('login')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a237e', justifyContent: 'center', alignItems: 'center' },
  card: {
    width: '85%', backgroundColor: '#fff', borderRadius: 16,
    padding: 30, alignItems: 'center', elevation: 8,
  },
  company: { fontSize: 22, fontWeight: 'bold', color: '#1a237e', letterSpacing: 2 },
  appName: { fontSize: 16, color: '#888', marginBottom: 30, letterSpacing: 4 },
  input: {
    width: '100%', borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    padding: 12, marginBottom: 16, fontSize: 15,
  },
  button: {
    backgroundColor: '#1a237e', width: '100%', padding: 15,
    borderRadius: 8, alignItems: 'center', marginTop: 8,
  },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
