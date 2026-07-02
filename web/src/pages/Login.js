import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.company}>BUILD CHAIN</h1>
        <h2 style={styles.app}>SITE VIEW</h2>
        <p style={styles.subtitle}>Management Portal</p>

        <form onSubmit={handleLogin} style={styles.form}>
          <input
            style={styles.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.button} type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh', background: '#1a237e',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  card: {
    background: '#fff', borderRadius: 16, padding: 48,
    width: 380, boxShadow: '0 8px 32px rgba(0,0,0,0.2)', textAlign: 'center',
  },
  company: { color: '#1a237e', fontSize: 26, margin: 0, letterSpacing: 3 },
  app: { color: '#555', fontSize: 16, margin: '4px 0 4px', letterSpacing: 5, fontWeight: 400 },
  subtitle: { color: '#aaa', fontSize: 13, marginBottom: 32 },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  input: {
    padding: '14px 16px', borderRadius: 8, border: '1px solid #ddd',
    fontSize: 15, outline: 'none',
  },
  button: {
    padding: '14px', background: '#1a237e', color: '#fff',
    border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 'bold',
    cursor: 'pointer', marginTop: 8,
  },
  error: { color: '#c62828', fontSize: 14, margin: 0 },
};
