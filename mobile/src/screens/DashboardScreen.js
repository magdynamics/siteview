import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Modal, ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { punchIn, punchOut, getTodayPunches } from '../services/api';

const BREAK_TYPES = ['lunch', 'short'];

export default function DashboardScreen() {
  const { t } = useTranslation();
  const { profile, logout } = useAuth();
  const [punches, setPunches] = useState([]);
  const [status, setStatus] = useState('out'); // 'out', 'in', 'break'
  const [loading, setLoading] = useState(false);
  const [showBreakModal, setShowBreakModal] = useState(false);
  const [todayHours, setTodayHours] = useState({ total: 0, break: 0, billable: 0 });

  useEffect(() => {
    loadTodayPunches();
  }, []);

  const loadTodayPunches = async () => {
    try {
      const res = await getTodayPunches(profile.uid);
      const data = res.data;
      setPunches(data);
      calculateStatus(data);
      calculateHours(data);
    } catch {}
  };

  const calculateStatus = (data) => {
    if (data.length === 0) return setStatus('out');
    const last = data[data.length - 1];
    if (last.type === 'in') setStatus('in');
    else if (last.type === 'out') setStatus('out');
    else if (last.type.startsWith('break')) setStatus('break');
  };

  const calculateHours = (data) => {
    let totalMs = 0, breakMs = 0;
    let punchInTime = null, breakOutTime = null;

    data.forEach(p => {
      if (p.type === 'in') punchInTime = new Date(p.timestamp);
      else if (p.type === 'out' && punchInTime) {
        totalMs += new Date(p.timestamp) - punchInTime;
        punchInTime = null;
      } else if (p.type.startsWith('break_out')) {
        breakOutTime = new Date(p.timestamp);
      } else if (p.type.startsWith('break_in') && breakOutTime) {
        breakMs += new Date(p.timestamp) - breakOutTime;
        breakOutTime = null;
      }
    });

    // If still punched in
    if (punchInTime) totalMs += new Date() - punchInTime;

    const total = +(totalMs / 3600000).toFixed(2);
    const brk = +(breakMs / 3600000).toFixed(2);
    setTodayHours({ total, break: brk, billable: +(total - brk).toFixed(2) });
  };

  const handlePunchIn = async () => {
    setLoading(true);
    try {
      const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
      if (locStatus !== 'granted') {
        Alert.alert('Error', t('locationRequired'));
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });

      await punchIn({
        siteId: profile.assignedSiteId,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });

      await loadTodayPunches();
      Alert.alert('', t('punchedInAt') + ' ' + new Date().toLocaleTimeString());
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || t('networkError'));
    } finally {
      setLoading(false);
    }
  };

  const handlePunchOut = () => {
    Alert.alert(t('confirmPunchOut'), t('confirmPunchOutMsg'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('confirm'), onPress: async () => {
          setLoading(true);
          try {
            const loc = await Location.getCurrentPositionAsync({});
            const res = await punchOut({
              siteId: profile.assignedSiteId,
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            });
            await loadTodayPunches();
            const needed = res.data?.hoursLogNeeded;
            if (needed?.length) {
              Alert.alert(
                t('hoursLogReminder'),
                `${t('hoursLogReminderMsg')}\n${needed.map(e => `• ${e.name}`).join('\n')}`
              );
            }
          } catch (err) {
            Alert.alert('Error', t('networkError'));
          } finally {
            setLoading(false);
          }
        }
      }
    ]);
  };

  const handleBreakOut = async (breakType) => {
    setShowBreakModal(false);
    setLoading(true);
    try {
      await punchOut({ siteId: profile.assignedSiteId, breakType: `out_${breakType}` });
      await loadTodayPunches();
    } catch {
      Alert.alert('Error', t('networkError'));
    } finally {
      setLoading(false);
    }
  };

  const handleBreakIn = async () => {
    setLoading(true);
    try {
      await punchIn({ siteId: profile.assignedSiteId, breakType: 'in' });
      await loadTodayPunches();
    } catch {
      Alert.alert('Error', t('networkError'));
    } finally {
      setLoading(false);
    }
  };

  const statusColor = status === 'in' ? '#2e7d32' : status === 'break' ? '#e65100' : '#b71c1c';

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{t('goodMorning')},</Text>
          <Text style={styles.name}>{profile?.name}</Text>
        </View>
        <TouchableOpacity onPress={logout}>
          <Text style={styles.logoutText}>{t('logout')}</Text>
        </TouchableOpacity>
      </View>

      {/* Status Card */}
      <View style={[styles.statusCard, { borderLeftColor: statusColor }]}>
        <Text style={styles.siteName}>{profile?.assignedSiteId}</Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
          <Text style={styles.statusText}>
            {status === 'in' ? t('onSite') : status === 'break' ? t('onBreak') : t('offSite')}
          </Text>
        </View>
      </View>

      {/* Hours Summary */}
      <View style={styles.hoursCard}>
        <Text style={styles.sectionTitle}>{t('todaySummary')}</Text>
        <View style={styles.hoursRow}>
          <HourBox label={t('totalHours')} value={todayHours.total} />
          <HourBox label={t('breakHours')} value={todayHours.break} color="#e65100" />
          <HourBox label={t('billableHours')} value={todayHours.billable} color="#2e7d32" />
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionsCard}>
        {loading && <ActivityIndicator size="large" color="#1a237e" style={{ marginBottom: 16 }} />}

        {status === 'out' && (
          <ActionButton label={t('punchIn')} color="#2e7d32" onPress={handlePunchIn} />
        )}

        {status === 'in' && (
          <>
            <ActionButton label={t('breakOut')} color="#e65100" onPress={() => setShowBreakModal(true)} />
            <ActionButton label={t('punchOut')} color="#b71c1c" onPress={handlePunchOut} />
          </>
        )}

        {status === 'break' && (
          <ActionButton label={t('breakIn')} color="#1565c0" onPress={handleBreakIn} />
        )}
      </View>

      {/* Break Modal */}
      <Modal visible={showBreakModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('breakOut')}</Text>
            <TouchableOpacity style={styles.breakOption} onPress={() => handleBreakOut('lunch')}>
              <Text style={styles.breakOptionText}>{t('lunch')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.breakOption} onPress={() => handleBreakOut('short')}>
              <Text style={styles.breakOptionText}>{t('shortBreak')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowBreakModal(false)}>
              <Text style={styles.cancelText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const HourBox = ({ label, value, color = '#333' }) => (
  <View style={styles.hourBox}>
    <Text style={[styles.hourValue, { color }]}>{value}h</Text>
    <Text style={styles.hourLabel}>{label}</Text>
  </View>
);

const ActionButton = ({ label, color, onPress }) => (
  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: color }]} onPress={onPress}>
    <Text style={styles.actionBtnText}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#1a237e', padding: 20, paddingTop: 50,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  greeting: { color: '#aab2e8', fontSize: 14 },
  name: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  logoutText: { color: '#aab2e8', fontSize: 14 },
  statusCard: {
    margin: 16, backgroundColor: '#fff', borderRadius: 12, padding: 16,
    borderLeftWidth: 5, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    elevation: 2,
  },
  siteName: { fontSize: 16, fontWeight: '600', color: '#333' },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  statusText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  hoursCard: { margin: 16, marginTop: 0, backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#1a237e', marginBottom: 12 },
  hoursRow: { flexDirection: 'row', justifyContent: 'space-around' },
  hourBox: { alignItems: 'center' },
  hourValue: { fontSize: 24, fontWeight: 'bold' },
  hourLabel: { fontSize: 11, color: '#888', marginTop: 4, textAlign: 'center' },
  actionsCard: { margin: 16, marginTop: 0 },
  actionBtn: {
    padding: 18, borderRadius: 12, alignItems: 'center', marginBottom: 12, elevation: 2,
  },
  actionBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#1a237e', marginBottom: 16, textAlign: 'center' },
  breakOption: {
    padding: 16, backgroundColor: '#f5f5f5', borderRadius: 10, marginBottom: 10, alignItems: 'center',
  },
  breakOptionText: { fontSize: 16, fontWeight: '600', color: '#333' },
  cancelText: { textAlign: 'center', color: '#888', marginTop: 8, fontSize: 15 },
});
