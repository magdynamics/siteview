import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ScrollView, ActivityIndicator, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import api, { uploadDocument } from '../services/api';

const DOC_TYPES = ['receipt', 'vendor_invoice', 'delivery_note', 'other'];

export default function DocumentScanScreen() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [docType, setDocType] = useState('receipt');
  const [vendorName, setVendorName] = useState('');
  const [vendors, setVendors] = useState([]);
  const [vendorId, setVendorId] = useState(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);

  // registered vendors — picking one links the scan to the vendor record
  useEffect(() => {
    api.get('/vendors').then(r => setVendors(r.data)).catch(() => {});
  }, []);

  const pickVendor = (v) => {
    if (vendorId === v.id) { setVendorId(null); setVendorName(''); }
    else { setVendorId(v.id); setVendorName(v.name); }
  };

  const scanDocument = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Error', t('cameraPermission'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.4 });
    if (!result.canceled) setFile({ uri: result.assets[0].uri, type: 'image/jpeg', name: `scan_${Date.now()}.jpg` });
  };

  const uploadFromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.4 });
    if (!result.canceled) setFile({ uri: result.assets[0].uri, type: 'image/jpeg', name: `doc_${Date.now()}.jpg` });
  };

  const handleSubmit = async () => {
    if (!file) { Alert.alert('Error', 'Please scan or upload a document'); return; }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('document', file);
      formData.append('documentType', docType);
      formData.append('siteId', profile.assignedSiteId);
      formData.append('vendorName', vendorName);
      formData.append('amount', amount);
      formData.append('description', description);
      if (vendorId) {
        formData.append('relatedType', 'vendor');
        formData.append('relatedId', vendorId);
      }

      await uploadDocument(formData);
      Alert.alert('', 'Document uploaded successfully');
      setFile(null);
      setVendorName('');
      setVendorId(null);
      setAmount('');
      setDescription('');
    } catch {
      Alert.alert('Error', t('networkError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('documents')}</Text>
      </View>

      <View style={styles.card}>
        {/* Document Type Selector */}
        <Text style={styles.label}>{t('documentType')}</Text>
        <View style={styles.typeRow}>
          {DOC_TYPES.map(type => (
            <TouchableOpacity
              key={type}
              style={[styles.typeBtn, docType === type && styles.typeBtnActive]}
              onPress={() => setDocType(type)}
            >
              <Text style={[styles.typeBtnText, docType === type && styles.typeBtnTextActive]}>
                {t(type)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* File Upload */}
        <View style={styles.uploadRow}>
          <TouchableOpacity style={styles.uploadBtn} onPress={scanDocument}>
            <Text style={styles.uploadBtnText}>📷 {t('scanDocument')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.uploadBtn, styles.uploadBtnSecondary]} onPress={uploadFromGallery}>
            <Text style={styles.uploadBtnText}>🖼 {t('uploadDocument')}</Text>
          </TouchableOpacity>
        </View>

        {file && (
          <View style={styles.previewBox}>
            <Image source={{ uri: file.uri }} style={styles.preview} />
            <Text style={styles.fileName}>{file.name}</Text>
          </View>
        )}

        {/* Registered vendors — tap to link the scan to the vendor record */}
        {vendors.length > 0 && (
          <View style={styles.typeRow}>
            {vendors.map(v => (
              <TouchableOpacity
                key={v.id}
                style={[styles.typeBtn, vendorId === v.id && styles.typeBtnActive]}
                onPress={() => pickVendor(v)}
              >
                <Text style={[styles.typeBtnText, vendorId === v.id && styles.typeBtnTextActive]}>
                  🏷 {v.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Fields */}
        <TextInput
          style={styles.input}
          placeholder={t('vendorName')}
          value={vendorName}
          onChangeText={text => { setVendorName(text); setVendorId(null); }}
        />
        <TextInput
          style={styles.input}
          placeholder={t('amount') + ' ($)'}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
        />
        <TextInput
          style={[styles.input, { minHeight: 70 }]}
          placeholder={t('description')}
          value={description}
          onChangeText={setDescription}
          multiline
        />

        {loading ? (
          <ActivityIndicator size="large" color="#1a237e" style={{ marginTop: 16 }} />
        ) : (
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            <Text style={styles.submitBtnText}>Upload Document</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#1a237e', padding: 20, paddingTop: 50 },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  card: { margin: 16, backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 2 },
  label: { fontSize: 14, color: '#666', marginBottom: 8 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16, gap: 8 },
  typeBtn: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: '#ddd', backgroundColor: '#f9f9f9',
  },
  typeBtnActive: { backgroundColor: '#1a237e', borderColor: '#1a237e' },
  typeBtnText: { fontSize: 13, color: '#333' },
  typeBtnTextActive: { color: '#fff', fontWeight: 'bold' },
  uploadRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  uploadBtn: {
    flex: 1, backgroundColor: '#1a237e', padding: 14,
    borderRadius: 10, alignItems: 'center',
  },
  uploadBtnSecondary: { backgroundColor: '#455a64' },
  uploadBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  previewBox: { alignItems: 'center', marginBottom: 16 },
  preview: { width: '100%', height: 160, borderRadius: 8, marginBottom: 6 },
  fileName: { fontSize: 12, color: '#888' },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    padding: 12, fontSize: 15, marginBottom: 12,
  },
  submitBtn: {
    backgroundColor: '#2e7d32', padding: 16, borderRadius: 10,
    alignItems: 'center', marginTop: 8,
  },
  submitBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
