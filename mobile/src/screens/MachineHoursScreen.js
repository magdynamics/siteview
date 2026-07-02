import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

export default function MachineHoursScreen() {
  const { profile } = useAuth();
  const [equipment, setEquipment] = useState([]);
  const [selected, setSelected] = useState(null);
  const [hours, setHours] = useState('');
  const [odometer, setOdometer] = useState('');
  const [fuelAdded, setFuelAdded] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(null);

  useEffect(() => { loadEquipment(); }, []);

  const loadEquipment = async () => {
    try {
      const res = await api.get('/equipment', { params: { siteId: profile.assignedSiteId } });
      setEquipment(res.data);
    } catch {}
  };

  const loadSummary = async (equip) => {
    try {
      const res = await api.get(`/machine-hours/summary/${equip.id}`);
      setSummary(res.data);
      setHours(equip.currentHours ? String(equip.currentHours) : '');
    } catch {}
  };

  const selectEquip = (equip) => {
    setSelected(equip);
    setSummary(null);
    loadSummary(equip);
  };

  const submitHours = async () => {
    if (!hours) { Alert.alert('Error', 'Please enter current machine hours'); return; }
    setLoading(true);
    try {
      const res = await api.post('/machine-hours', {
        equipmentId: selected.id,
        equipmentName: selected.name,
        siteId: profile.assignedSiteId,
        hours,
        odometerReading: odometer || null,
        fuelAdded: fuelAdded || null,
        notes,
      });

      const { alerts } = res.data;
      let msg = 'Hours logged successfully';
      if (alerts?.length > 0) {
        const overdueAlerts = alerts.filter(a => a.type === 'overdue');
        const dueSoonAlerts = alerts.filter(a => a.type === 'due_soon');
        if (overdueAlerts.length) msg += `\n\n⚠️ ${overdueAlerts.length} maintenance task(s) are OVERDUE`;
        if (dueSoonAlerts.length) msg += `\n\n🔔 ${dueSoonAlerts.length} maintenance task(s) due soon`;
      }
      Alert.alert('', msg);
      setHours('');
      setOdometer('');
      setFuelAdded('');
      setNotes('');
      setSelected(null);
      setSummary(null);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Could not log hours');
    } finally { setLoading(false); }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Machine Hours</Text>
        {selected && (
          <TouchableOpacity onPress={() => { setSelected(null); setSummary(null); }}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        )}
      </View>

      {!selected ? (
        <ScrollView style={styles.body}>
          <Text style={styles.hint}>Select equipment to log daily hours</Text>
          {equipment.map(eq => (
            <TouchableOpacity key={eq.id} style={styles.equipCard} onPress={() => selectEquip(eq)}>
              <View style={styles.equipInfo}>
                <Text style={styles.equipName}>{eq.name}</Text>
                <Text style={styles.equipType}>{eq.typeName}</Text>
                {eq.currentHours ? (
                  <Text style={styles.hoursText}>Current: {eq.currentHours} hrs</Text>
                ) : (
                  <Text style={styles.hoursTextMissing}>No hours recorded yet</Text>
                )}
              </View>
              <Text style={styles.arrow}>›</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : (
        <ScrollView style={styles.body}>
          {/* Equipment Info */}
          <View style={styles.card}>
            <Text style={styles.equipTitle}>{selected.name}</Text>
            <Text style={styles.equipTypeText}>{selected.typeName}</Text>
            {summary && (
              <View style={styles.summaryRow}>
                <SummaryBox label="Current Hours" value={`${summary.currentHours} hrs`} />
                {summary.totalMaintenanceCost !== undefined && (
                  <SummaryBox label="Maintenance Cost" value={`$${summary.totalMaintenanceCost}`} color="#e65100" />
                )}
                <SummaryBox label="Records" value={summary.maintenanceCount} />
              </View>
            )}
          </View>

          {/* Upcoming Maintenance */}
          {summary?.schedules?.filter(s => s.hoursUntilDue !== null).length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Upcoming by Hours</Text>
              {summary.schedules.filter(s => s.hoursUntilDue !== null).map((s, i) => (
                <View key={i} style={styles.scheduleRow}>
                  <Text style={styles.scheduleType}>{s.maintenanceType?.replace('_', ' ')}</Text>
                  <Text style={[
                    styles.scheduleHours,
                    { color: s.hoursUntilDue <= 0 ? '#b71c1c' : s.hoursUntilDue <= 50 ? '#e65100' : '#2e7d32' }
                  ]}>
                    {s.hoursUntilDue <= 0
                      ? `${Math.abs(s.hoursUntilDue).toFixed(0)} hrs OVERDUE`
                      : `${s.hoursUntilDue.toFixed(0)} hrs remaining`}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Log Hours Form */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Log Today's Reading</Text>
            <Text style={styles.fieldLabel}>Machine Hours *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 1258"
              value={hours}
              onChangeText={setHours}
              keyboardType="decimal-pad"
            />
            <Text style={styles.fieldLabel}>Odometer (km/mi) — vehicles only</Text>
            <TextInput
              style={styles.input}
              placeholder="Optional"
              value={odometer}
              onChangeText={setOdometer}
              keyboardType="decimal-pad"
            />
            <Text style={styles.fieldLabel}>Fuel Added (liters/gallons)</Text>
            <TextInput
              style={styles.input}
              placeholder="Optional"
              value={fuelAdded}
              onChangeText={setFuelAdded}
              keyboardType="decimal-pad"
            />
            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput
              style={[styles.input, { minHeight: 70 }]}
              placeholder="Any observations..."
              value={notes}
              onChangeText={setNotes}
              multiline
            />
          </View>

          {loading ? (
            <ActivityIndicator size="large" color="#1a237e" style={{ margin: 24 }} />
          ) : (
            <TouchableOpacity style={styles.submitBtn} onPress={submitHours}>
              <Text style={styles.submitBtnText}>Save Hours</Text>
            </TouchableOpacity>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

const SummaryBox = ({ label, value, color = '#1a237e' }) => (
  <View style={{ alignItems: 'center' }}>
    <Text style={{ fontSize: 20, fontWeight: 'bold', color }}>{value}</Text>
    <Text style={{ fontSize: 11, color: '#888', marginTop: 2, textAlign: 'center' }}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#1a237e', padding: 20, paddingTop: 50,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  backText: { color: '#aab2e8', fontSize: 15 },
  body: { flex: 1, padding: 12 },
  hint: { color: '#888', fontSize: 13, marginBottom: 12 },
  equipCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', elevation: 2,
  },
  equipInfo: { flex: 1 },
  equipName: { fontSize: 16, fontWeight: 'bold', color: '#1a237e' },
  equipType: { fontSize: 13, color: '#888' },
  hoursText: { fontSize: 13, color: '#2e7d32', marginTop: 4, fontWeight: '600' },
  hoursTextMissing: { fontSize: 13, color: '#aaa', marginTop: 4 },
  arrow: { fontSize: 24, color: '#ccc' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, elevation: 2 },
  equipTitle: { fontSize: 18, fontWeight: 'bold', color: '#1a237e' },
  equipTypeText: { fontSize: 13, color: '#888', marginBottom: 12 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#1a237e', marginBottom: 12 },
  scheduleRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  scheduleType: { fontSize: 14, color: '#333', textTransform: 'capitalize' },
  scheduleHours: { fontSize: 14, fontWeight: 'bold' },
  fieldLabel: { fontSize: 13, color: '#666', marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    padding: 12, fontSize: 15, marginBottom: 14,
  },
  submitBtn: {
    backgroundColor: '#1a237e', margin: 4, marginBottom: 12, padding: 18,
    borderRadius: 12, alignItems: 'center',
  },
  submitBtnText: { color: '#fff', fontSize: 17, fontWeight: 'bold' },
});
