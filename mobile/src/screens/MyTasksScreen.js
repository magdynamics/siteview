import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Alert, RefreshControl,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import api from '../services/api';

const STATUS_COLOR = {
  assigned: '#888', acknowledged: '#1565c0', in_progress: '#e65100',
  blocked: '#b71c1c', complete: '#2e7d32',
};

export default function MyTasksScreen() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [mediaByTask, setMediaByTask] = useState({});
  const [uploading, setUploading] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/tasks', { params: { assignedTo: 'me' } });
      const today = new Date().toISOString().split('T')[0];
      // open tasks plus anything completed today
      const visible = res.data.filter(x => x.status !== 'complete' || x.scheduledDate === today);
      setTasks(visible);
      // photo counts per task (before/after gate)
      const counts = {};
      for (const task of visible) {
        try {
          const m = await api.get(`/tasks/${task.id}/media`);
          counts[task.id] = {
            before: m.data.filter(x => x.phase === 'before').length,
            during: m.data.filter(x => x.phase === 'during').length,
            after: m.data.filter(x => x.phase === 'after').length,
          };
        } catch { counts[task.id] = { before: 0, during: 0, after: 0 }; }
      }
      setMediaByTask(counts);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const act = async (fn, successMsg) => {
    try {
      await fn();
      await load();
      if (successMsg) Alert.alert('', successMsg);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || t('networkError'));
    }
  };

  const acknowledge = (task) => act(() => api.post(`/tasks/${task.id}/acknowledge`), t('taskAcknowledged'));
  const start = (task) => act(() => api.patch(`/tasks/${task.id}/status`, { status: 'in_progress' }));
  const complete = (task) => act(() => api.patch(`/tasks/${task.id}/status`, { status: 'complete' }), t('taskCompleted'));
  const resume = (task) => act(() => api.patch(`/tasks/${task.id}/status`, { status: 'in_progress' }));

  // tap → choose photo or short video clip as evidence
  const captureEvidence = (task, phase) => {
    Alert.alert(t('addEvidence'), '', [
      { text: `📷 ${t('takePhoto')}`, onPress: () => capture(task, phase, false) },
      { text: `🎥 ${t('recordVideo')}`, onPress: () => capture(task, phase, true) },
      { text: t('cancel'), style: 'cancel' },
    ]);
  };

  const capture = async (task, phase, video) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Error', t('cameraRequired')); return; }
    const result = await ImagePicker.launchCameraAsync(video
      ? { mediaTypes: ImagePicker.MediaTypeOptions.Videos, videoMaxDuration: 20 }
      : { quality: 0.4 });
    if (result.canceled || !result.assets?.[0]) return;

    setUploading(task.id + phase);
    try {
      const formData = new FormData();
      formData.append('photo', {
        uri: result.assets[0].uri,
        name: video ? `${phase}.mp4` : `${phase}.jpg`,
        type: video ? 'video/mp4' : 'image/jpeg',
      });
      formData.append('phase', phase);
      await api.post(`/tasks/${task.id}/media`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      await load();
      Alert.alert('', t('photoUploaded'));
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || t('networkError'));
    } finally { setUploading(null); }
  };

  const block = (task) => {
    Alert.alert(t('blockTask'), t('blockReasonTitle'), [
      { text: t('waitingMaterials'), onPress: () => act(() => api.patch(`/tasks/${task.id}/status`, { status: 'blocked', blockedReason: t('waitingMaterials') })) },
      { text: t('equipmentDown'), onPress: () => act(() => api.patch(`/tasks/${task.id}/status`, { status: 'blocked', blockedReason: t('equipmentDown') })) },
      { text: t('otherReason'), onPress: () => act(() => api.patch(`/tasks/${task.id}/status`, { status: 'blocked', blockedReason: t('otherReason') })) },
      { text: t('cancel'), style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('myTasks')}</Text>
      </View>
      <ScrollView
        style={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {tasks.length === 0 && <Text style={styles.empty}>{t('noTasks')}</Text>}
        {tasks.map(task => (
          <View key={task.id} style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.taskTitle}>{task.title}</Text>
              <View style={[styles.badge, { backgroundColor: STATUS_COLOR[task.status] }]}>
                <Text style={styles.badgeText}>{t(`status_${task.status}`)}</Text>
              </View>
            </View>
            {!!task.planReference && <Text style={styles.planRef}>📐 {task.planReference}</Text>}
            {!!task.description && <Text style={styles.desc}>{task.description}</Text>}
            <Text style={styles.date}>📅 {task.scheduledDate}</Text>
            {task.status === 'blocked' && !!task.blockedReason && (
              <Text style={styles.blockedText}>🚧 {task.blockedReason}</Text>
            )}

            <View style={styles.actions}>
              {task.status === 'assigned' && (
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#1565c0' }]} onPress={() => acknowledge(task)}>
                  <Text style={styles.actionText}>{t('acknowledge')}</Text>
                </TouchableOpacity>
              )}
              {task.status === 'acknowledged' && (
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#e65100' }]} onPress={() => start(task)}>
                  <Text style={styles.actionText}>{t('startTask')}</Text>
                </TouchableOpacity>
              )}
              {task.status === 'in_progress' && (() => {
                const m = mediaByTask[task.id] || { before: 0, during: 0, after: 0 };
                const canComplete = m.before > 0 && m.after > 0;
                return (
                  <>
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: canComplete ? '#2e7d32' : '#9e9e9e' }]}
                      onPress={() => canComplete ? complete(task) : Alert.alert('', t('photosRequired'))}>
                      <Text style={styles.actionText}>{t('completeTask')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#b71c1c' }]} onPress={() => block(task)}>
                      <Text style={styles.actionText}>{t('blockTask')}</Text>
                    </TouchableOpacity>
                  </>
                );
              })()}
              {task.status === 'blocked' && (
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#1565c0' }]} onPress={() => resume(task)}>
                  <Text style={styles.actionText}>{t('resumeTask')}</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Photo evidence: before/during/after — visible on every open task */}
            {task.status !== 'complete' && (() => {
              const m = mediaByTask[task.id] || { before: 0, during: 0, after: 0 };
              return (
                <View style={styles.photoRow}>
                  {[['before', t('beforePhoto')], ['during', t('duringPhoto')], ['after', t('afterPhoto')]].map(([phase, label]) => (
                    <TouchableOpacity
                      key={phase}
                      style={[styles.photoBtn, m[phase] > 0 && styles.photoBtnDone]}
                      disabled={uploading === task.id + phase}
                      onPress={() => captureEvidence(task, phase)}>
                      <Text style={[styles.photoBtnText, m[phase] > 0 && { color: '#2e7d32' }]}>
                        {uploading === task.id + phase ? '…' : `📷 ${label}${m[phase] > 0 ? ` ✓${m[phase]}` : ''}`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              );
            })()}
          </View>
        ))}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#1a237e', padding: 20, paddingTop: 50 },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  body: { flex: 1, padding: 12 },
  empty: { textAlign: 'center', color: '#888', marginTop: 40, fontSize: 15 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, elevation: 2 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  taskTitle: { fontSize: 16, fontWeight: 'bold', color: '#1a237e', flex: 1, marginRight: 8 },
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  planRef: { fontSize: 13, color: '#555', marginTop: 6 },
  desc: { fontSize: 13, color: '#666', marginTop: 4 },
  date: { fontSize: 12, color: '#888', marginTop: 6 },
  blockedText: { fontSize: 13, color: '#b71c1c', marginTop: 6, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionBtn: { flex: 1, borderRadius: 8, padding: 12, alignItems: 'center' },
  actionText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  photoRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  photoBtn: { flex: 1, borderRadius: 8, borderWidth: 1, borderColor: '#c5cae9', padding: 9, alignItems: 'center', backgroundColor: '#f8f9ff' },
  photoBtnDone: { borderColor: '#2e7d32', backgroundColor: '#e8f5e9' },
  photoBtnText: { fontSize: 12, color: '#1a237e', fontWeight: '600' },
});
