import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert, TextInput, ActivityIndicator, Switch,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const CONDITIONS = [
  { value: 'good', label: 'All Good', color: '#2e7d32' },
  { value: 'minor_issues', label: 'Minor Issues', color: '#f57c00' },
  { value: 'major_issues', label: 'Major Issues', color: '#e65100' },
  { value: 'unsafe', label: 'UNSAFE — Do Not Operate', color: '#b71c1c' },
];

export default function InspectionScreen() {
  const { profile } = useAuth();
  const [equipment, setEquipment] = useState([]);
  const [selectedEquip, setSelectedEquip] = useState(null);
  const [inspectionType, setInspectionType] = useState('pre_use');
  const [checklistItems, setChecklistItems] = useState([]);
  const [overallCondition, setOverallCondition] = useState('good');
  const [hoursReading, setHoursReading] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('select'); // 'select' | 'checklist' | 'summary'

  useEffect(() => {
    loadEquipment();
  }, []);

  const loadEquipment = async () => {
    try {
      const res = await api.get('/equipment', { params: { siteId: profile.assignedSiteId } });
      setEquipment(res.data.filter(e => e.status !== 'out_of_service'));
    } catch {}
  };

  const loadChecklist = async (equip) => {
    setSelectedEquip(equip);
    setLoading(true);
    try {
      const typeKey = equip.typeName?.toLowerCase().replace(/\s+/g, '_') || 'default';
      const res = await api.get(`/inspections/template/${typeKey}`);
      const items = res.data.items.map(item => ({ item, passed: true, note: '' }));
      setChecklistItems(items);
      setStep('checklist');
    } catch {
      Alert.alert('Error', 'Could not load checklist');
    } finally { setLoading(false); }
  };

  const toggleItem = (index, passed) => {
    const updated = [...checklistItems];
    updated[index] = { ...updated[index], passed };
    setChecklistItems(updated);
    // Auto set condition based on failures
    const failCount = updated.filter(i => !i.passed).length;
    if (failCount === 0) setOverallCondition('good');
    else if (failCount <= 2) setOverallCondition('minor_issues');
    else setOverallCondition('major_issues');
  };

  const setItemNote = (index, note) => {
    const updated = [...checklistItems];
    updated[index] = { ...updated[index], note };
    setChecklistItems(updated);
  };

  const submitInspection = async () => {
    if (!hoursReading && selectedEquip?.typeName !== 'Vehicle') {
      const proceed = await new Promise(resolve =>
        Alert.alert('Machine Hours', 'No hours reading entered. Continue?', [
          { text: 'Cancel', onPress: () => resolve(false) },
          { text: 'Continue', onPress: () => resolve(true) },
        ])
      );
      if (!proceed) return;
    }

    setLoading(true);
    try {
      const res = await api.post('/inspections', {
        equipmentId: selectedEquip.id,
        equipmentName: selectedEquip.name,
        siteId: profile.assignedSiteId,
        inspectionType,
        items: checklistItems,
        overallCondition,
        hoursReading: hoursReading || null,
        notes,
      });

      const { autoTicket } = res.data;

      if (autoTicket) {
        Alert.alert(
          overallCondition === 'unsafe' ? '🚨 Equipment Unsafe' : '⚠️ Issues Found',
          `A repair ticket has been automatically created and your supervisor has been notified.`,
          [{ text: 'OK', onPress: resetForm }]
        );
      } else {
        Alert.alert('✓ Inspection Submitted', 'Inspection recorded successfully');
        resetForm();
      }
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Could not submit inspection');
    } finally { setLoading(false); }
  };

  const resetForm = () => {
    setStep('select');
    setSelectedEquip(null);
    setChecklistItems([]);
    setOverallCondition('good');
    setHoursReading('');
    setNotes('');
  };

  const failedCount = checklistItems.filter(i => !i.passed).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Inspection</Text>
        {step !== 'select' && (
          <TouchableOpacity onPress={resetForm}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        )}
      </View>

      {step === 'select' && (
        <ScrollView style={styles.body}>
          {/* Inspection Type */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Inspection Type</Text>
            <View style={styles.typeRow}>
              {[{ val: 'pre_use', label: 'Pre-Use\n(Before Work)' }, { val: 'post_use', label: 'Post-Use\n(After Work)' }].map(t => (
                <TouchableOpacity
                  key={t.val}
                  style={[styles.typeBtn, inspectionType === t.val && styles.typeBtnActive]}
                  onPress={() => setInspectionType(t.val)}
                >
                  <Text style={[styles.typeBtnText, inspectionType === t.val && styles.typeBtnTextActive]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Equipment Selection */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Select Equipment to Inspect</Text>
            {loading ? <ActivityIndicator color="#1a237e" /> : equipment.map(eq => (
              <TouchableOpacity key={eq.id} style={styles.equipRow} onPress={() => loadChecklist(eq)}>
                <View>
                  <Text style={styles.equipName}>{eq.name}</Text>
                  <Text style={styles.equipType}>{eq.typeName}</Text>
                </View>
                <Text style={styles.arrowText}>›</Text>
              </TouchableOpacity>
            ))}
            {equipment.length === 0 && !loading && (
              <Text style={styles.emptyText}>No equipment available on this site</Text>
            )}
          </View>
        </ScrollView>
      )}

      {step === 'checklist' && (
        <ScrollView style={styles.body}>
          <View style={styles.card}>
            <Text style={styles.equipTitle}>{selectedEquip?.name}</Text>
            <Text style={styles.inspTypeLabel}>
              {inspectionType === 'pre_use' ? 'Pre-Use Inspection' : 'Post-Use Inspection'}
            </Text>
            {failedCount > 0 && (
              <View style={styles.failBanner}>
                <Text style={styles.failBannerText}>⚠️ {failedCount} item(s) failed</Text>
              </View>
            )}
          </View>

          {/* Checklist Items */}
          <View style={styles.card}>
            {checklistItems.map((ci, idx) => (
              <View key={idx} style={[styles.checkItem, !ci.passed && styles.checkItemFailed]}>
                <View style={styles.checkItemTop}>
                  <Text style={styles.checkItemLabel}>{ci.item}</Text>
                  <View style={styles.passFailRow}>
                    <TouchableOpacity
                      style={[styles.passBtn, ci.passed && styles.passBtnActive]}
                      onPress={() => toggleItem(idx, true)}
                    >
                      <Text style={[styles.passBtnText, ci.passed && styles.passBtnTextActive]}>✓ Pass</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.failBtn, !ci.passed && styles.failBtnActive]}
                      onPress={() => toggleItem(idx, false)}
                    >
                      <Text style={[styles.failBtnText, !ci.passed && styles.failBtnTextActive]}>✗ Fail</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {!ci.passed && (
                  <TextInput
                    style={styles.noteInput}
                    placeholder="Describe the issue..."
                    value={ci.note}
                    onChangeText={v => setItemNote(idx, v)}
                  />
                )}
              </View>
            ))}
          </View>

          {/* Machine Hours */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Machine Hours Reading</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 1250"
              value={hoursReading}
              onChangeText={setHoursReading}
              keyboardType="decimal-pad"
            />
          </View>

          {/* Overall Condition */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Overall Condition</Text>
            {CONDITIONS.map(c => (
              <TouchableOpacity
                key={c.value}
                style={[styles.conditionBtn, overallCondition === c.value && { borderColor: c.color, backgroundColor: c.color + '18' }]}
                onPress={() => setOverallCondition(c.value)}
              >
                <View style={[styles.conditionDot, { backgroundColor: c.color }]} />
                <Text style={[styles.conditionLabel, overallCondition === c.value && { color: c.color, fontWeight: 'bold' }]}>
                  {c.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Notes */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Additional Notes</Text>
            <TextInput
              style={[styles.input, { minHeight: 80 }]}
              placeholder="Any additional observations..."
              value={notes}
              onChangeText={setNotes}
              multiline
            />
          </View>

          {loading ? (
            <ActivityIndicator size="large" color="#1a237e" style={{ margin: 24 }} />
          ) : (
            <TouchableOpacity
              style={[styles.submitBtn, overallCondition === 'unsafe' && { backgroundColor: '#b71c1c' }]}
              onPress={submitInspection}
            >
              <Text style={styles.submitBtnText}>
                {overallCondition === 'unsafe' ? '🚨 Submit — Mark Unsafe' : '✓ Submit Inspection'}
              </Text>
            </TouchableOpacity>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#1a237e', padding: 20, paddingTop: 50,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  backText: { color: '#aab2e8', fontSize: 15 },
  body: { flex: 1 },
  card: { backgroundColor: '#fff', margin: 12, marginBottom: 0, borderRadius: 12, padding: 16, elevation: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#1a237e', marginBottom: 12 },
  typeRow: { flexDirection: 'row', gap: 12 },
  typeBtn: {
    flex: 1, padding: 14, borderRadius: 10, borderWidth: 1.5,
    borderColor: '#ddd', alignItems: 'center',
  },
  typeBtnActive: { borderColor: '#1a237e', backgroundColor: '#e8eaf6' },
  typeBtnText: { fontSize: 14, color: '#888', textAlign: 'center' },
  typeBtnTextActive: { color: '#1a237e', fontWeight: 'bold' },
  equipRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  equipName: { fontSize: 15, fontWeight: '600', color: '#333' },
  equipType: { fontSize: 12, color: '#888', marginTop: 2 },
  arrowText: { fontSize: 24, color: '#ccc' },
  emptyText: { color: '#aaa', textAlign: 'center', padding: 16 },
  equipTitle: { fontSize: 18, fontWeight: 'bold', color: '#1a237e' },
  inspTypeLabel: { fontSize: 13, color: '#888', marginTop: 4 },
  failBanner: {
    backgroundColor: '#fff3e0', borderRadius: 8, padding: 10, marginTop: 12,
    borderLeftWidth: 4, borderLeftColor: '#e65100',
  },
  failBannerText: { color: '#e65100', fontWeight: 'bold' },
  checkItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  checkItemFailed: { backgroundColor: '#fff8f6' },
  checkItemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  checkItemLabel: { fontSize: 14, color: '#333', flex: 1, marginRight: 12 },
  passFailRow: { flexDirection: 'row', gap: 8 },
  passBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#ddd' },
  passBtnActive: { backgroundColor: '#2e7d32', borderColor: '#2e7d32' },
  passBtnText: { fontSize: 13, color: '#888' },
  passBtnTextActive: { color: '#fff', fontWeight: 'bold' },
  failBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#ddd' },
  failBtnActive: { backgroundColor: '#b71c1c', borderColor: '#b71c1c' },
  failBtnText: { fontSize: 13, color: '#888' },
  failBtnTextActive: { color: '#fff', fontWeight: 'bold' },
  noteInput: {
    marginTop: 8, borderWidth: 1, borderColor: '#ffd0c0', borderRadius: 8,
    padding: 10, fontSize: 13, backgroundColor: '#fff8f6',
  },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    padding: 12, fontSize: 15,
  },
  conditionBtn: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    borderRadius: 10, borderWidth: 1.5, borderColor: '#ddd', marginBottom: 8,
  },
  conditionDot: { width: 14, height: 14, borderRadius: 7, marginRight: 12 },
  conditionLabel: { fontSize: 15, color: '#333' },
  submitBtn: {
    backgroundColor: '#1a237e', margin: 16, padding: 18,
    borderRadius: 12, alignItems: 'center',
  },
  submitBtnText: { color: '#fff', fontSize: 17, fontWeight: 'bold' },
});
