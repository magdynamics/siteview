import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const TYPES = ['injury', 'near_miss', 'property_damage', 'environmental', 'other'];
const SEVERITIES = ['minor', 'moderate', 'serious', 'critical'];
const SEVERITY_COLOR = { minor: '#1565c0', moderate: '#e65100', serious: '#b71c1c', critical: '#880e4f' };

// Field safety incident reporting (technical guideline §10.5). Workers see
// incidents first — one screen, no login to a desktop needed.
export default function SafetyScreen() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [incidentType, setIncidentType] = useState('near_miss');
  const [severity, setSeverity] = useState('minor');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [photoUri, setPhotoUri] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Error', t('cameraRequired')); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.4 });
    if (!result.canceled && result.assets?.[0]) setPhotoUri(result.assets[0].uri);
  };

  const submit = async () => {
    if (!description.trim()) { Alert.alert('', t('incidentDescriptionRequired')); return; }
    setSubmitting(true);
    try {
      const res = await api.post('/safety', {
        siteId: profile.assignedSiteId,
        incidentType, severity,
        description: description.trim(),
        location: location.trim(),
      });
      const incidentId = res.data.incident.id;
      if (photoUri) {
        try {
          const formData = new FormData();
          formData.append('photo', { uri: photoUri, name: 'incident.jpg', type: 'image/jpeg' });
          await api.post(`/safety/${incidentId}/photos`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        } catch {}
      }
      setDescription(''); setLocation(''); setPhotoUri(null);
      setIncidentType('near_miss'); setSeverity('minor');
      Alert.alert('', t('incidentReported'));
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || t('networkError'));
    } finally { setSubmitting(false); }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>🦺 {t('safety')}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{t('incidentType')}</Text>
        <View style={styles.chipRow}>
          {TYPES.map(type => (
            <TouchableOpacity
              key={type}
              style={[styles.chip, incidentType === type && styles.chipActive]}
              onPress={() => setIncidentType(type)}>
              <Text style={[styles.chipText, incidentType === type && styles.chipTextActive]}>
                {t(`incident_${type}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>{t('severity')}</Text>
        <View style={styles.chipRow}>
          {SEVERITIES.map(sev => (
            <TouchableOpacity
              key={sev}
              style={[styles.chip, severity === sev && { backgroundColor: SEVERITY_COLOR[sev], borderColor: SEVERITY_COLOR[sev] }]}
              onPress={() => setSeverity(sev)}>
              <Text style={[styles.chipText, severity === sev && styles.chipTextActive]}>
                {t(`severity_${sev}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>{t('whatHappened')}</Text>
        <TextInput
          style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
          multiline
          value={description}
          onChangeText={setDescription}
          placeholder={t('whatHappenedPlaceholder')}
        />

        <Text style={styles.label}>{t('incidentLocation')}</Text>
        <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder={t('incidentLocationPlaceholder')} />

        <TouchableOpacity style={[styles.photoBtn, photoUri && styles.photoBtnDone]} onPress={takePhoto}>
          <Text style={[styles.photoBtnText, photoUri && { color: '#2e7d32' }]}>
            {photoUri ? `📷 ${t('photoAttached')} ✓` : `📷 ${t('takePhoto')}`}
          </Text>
        </TouchableOpacity>

        {submitting
          ? <ActivityIndicator size="large" color="#1a237e" style={{ marginTop: 16 }} />
          : (
            <TouchableOpacity style={styles.submitBtn} onPress={submit}>
              <Text style={styles.submitText}>{t('reportIncident')}</Text>
            </TouchableOpacity>
          )}
        <Text style={styles.hint}>{t('seriousPagesManagers')}</Text>
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#1a237e', padding: 20, paddingTop: 50 },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  card: { margin: 16, backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 2 },
  label: { fontSize: 13, fontWeight: '600', color: '#1a237e', marginBottom: 8, marginTop: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#c5cae9', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#f8f9ff' },
  chipActive: { backgroundColor: '#1a237e', borderColor: '#1a237e' },
  chipText: { fontSize: 13, color: '#333' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#c5cae9', borderRadius: 10, padding: 12, fontSize: 14, backgroundColor: '#fafafa' },
  photoBtn: { borderWidth: 1, borderColor: '#c5cae9', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 16, backgroundColor: '#f8f9ff' },
  photoBtnDone: { borderColor: '#2e7d32', backgroundColor: '#e8f5e9' },
  photoBtnText: { fontSize: 14, color: '#1a237e', fontWeight: '600' },
  submitBtn: { backgroundColor: '#b71c1c', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  hint: { fontSize: 11, color: '#999', textAlign: 'center', marginTop: 10 },
});
