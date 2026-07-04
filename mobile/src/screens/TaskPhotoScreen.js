import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, Image, ScrollView, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { uploadTaskPhoto } from '../services/api';

export default function TaskPhotoScreen() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [taskDescription, setTaskDescription] = useState('');
  const [beforePhoto, setBeforePhoto] = useState(null);
  const [afterPhoto, setAfterPhoto] = useState(null);
  const [loading, setLoading] = useState(false);

  const pickPhoto = async (photoType) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Error', t('cameraPermission'));
      return;
    }

    Alert.alert(
      photoType === 'before' ? t('beforePhoto') : t('afterPhoto'),
      '',
      [
        {
          text: t('takePhoto'), onPress: async () => {
            const result = await ImagePicker.launchCameraAsync({
              quality: 0.4, allowsEditing: false,
            });
            if (!result.canceled) {
              if (photoType === 'before') setBeforePhoto(result.assets[0]);
              else setAfterPhoto(result.assets[0]);
            }
          }
        },
        {
          text: t('uploadPhoto'), onPress: async () => {
            const result = await ImagePicker.launchImageLibraryAsync({
              quality: 0.4,
            });
            if (!result.canceled) {
              if (photoType === 'before') setBeforePhoto(result.assets[0]);
              else setAfterPhoto(result.assets[0]);
            }
          }
        },
        { text: t('cancel'), style: 'cancel' },
      ]
    );
  };

  const uploadPhoto = async (photo, photoType) => {
    const formData = new FormData();
    formData.append('photo', {
      uri: photo.uri,
      type: 'image/jpeg',
      name: `${photoType}_${Date.now()}.jpg`,
    });
    formData.append('photoType', photoType);
    formData.append('taskDescription', taskDescription);
    formData.append('siteId', profile.assignedSiteId);

    await uploadTaskPhoto(formData);
  };

  const handleSubmit = async () => {
    if (!taskDescription) {
      Alert.alert('Error', 'Please enter a task description');
      return;
    }
    if (!beforePhoto && !afterPhoto) {
      Alert.alert('Error', 'Please add at least one photo');
      return;
    }

    setLoading(true);
    try {
      if (beforePhoto) await uploadPhoto(beforePhoto, 'before');
      if (afterPhoto) await uploadPhoto(afterPhoto, 'after');

      Alert.alert('', t('photoUploaded'));
      setTaskDescription('');
      setBeforePhoto(null);
      setAfterPhoto(null);
    } catch {
      Alert.alert('Error', t('networkError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('tasks')}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{t('taskDescription')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('taskDescription')}
          value={taskDescription}
          onChangeText={setTaskDescription}
          multiline
          numberOfLines={3}
        />

        <Text style={styles.sectionTitle}>{t('beforePhoto')}</Text>
        <PhotoBox photo={beforePhoto} onPress={() => pickPhoto('before')} label={t('beforePhoto')} />

        <Text style={styles.sectionTitle}>{t('afterPhoto')}</Text>
        <PhotoBox photo={afterPhoto} onPress={() => pickPhoto('after')} label={t('afterPhoto')} />

        {loading ? (
          <ActivityIndicator size="large" color="#1a237e" style={{ marginTop: 16 }} />
        ) : (
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            <Text style={styles.submitBtnText}>Submit Task</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const PhotoBox = ({ photo, onPress, label }) => (
  <TouchableOpacity style={styles.photoBox} onPress={onPress}>
    {photo ? (
      <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
    ) : (
      <View style={styles.photoPlaceholder}>
        <Text style={styles.photoPlaceholderIcon}>📷</Text>
        <Text style={styles.photoPlaceholderText}>{label}</Text>
      </View>
    )}
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#1a237e', padding: 20, paddingTop: 50 },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  card: { margin: 16, backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 2 },
  label: { fontSize: 14, color: '#666', marginBottom: 8 },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    padding: 12, fontSize: 15, marginBottom: 16, minHeight: 80,
  },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#1a237e', marginBottom: 8, marginTop: 8 },
  photoBox: {
    width: '100%', height: 180, borderRadius: 10, overflow: 'hidden',
    borderWidth: 2, borderColor: '#ddd', borderStyle: 'dashed', marginBottom: 16,
  },
  photoPreview: { width: '100%', height: '100%' },
  photoPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f9f9f9' },
  photoPlaceholderIcon: { fontSize: 40, marginBottom: 8 },
  photoPlaceholderText: { color: '#aaa', fontSize: 14 },
  submitBtn: {
    backgroundColor: '#1a237e', padding: 16, borderRadius: 10,
    alignItems: 'center', marginTop: 8,
  },
  submitBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
