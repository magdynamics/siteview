import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, Alert, Modal, TextInput, ActivityIndicator, ScrollView,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import {
  getEquipment, getMyActiveEquipment,
  checkoutEquipment, checkinEquipment,
} from '../services/api';

const STATUS_COLOR = {
  available: '#2e7d32',
  in_use: '#1565c0',
  maintenance: '#e65100',
  out_of_service: '#b71c1c',
};

const STATUS_LABEL = {
  available: 'Available',
  in_use: 'In Use',
  maintenance: 'Maintenance',
  out_of_service: 'Out of Service',
};

const CONDITION_OPTIONS = [
  { value: 'good', label: 'Good condition', color: '#2e7d32' },
  { value: 'needs_maintenance', label: 'Needs maintenance', color: '#e65100' },
  { value: 'damaged', label: 'Damaged', color: '#b71c1c' },
];

export default function EquipmentScreen() {
  const { profile } = useAuth();
  const [equipment, setEquipment] = useState([]);
  const [myEquipment, setMyEquipment] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('available'); // 'available' | 'mine'
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [selectedEquip, setSelectedEquip] = useState(null);
  const [checkinCondition, setCheckinCondition] = useState('good');
  const [checkinNotes, setCheckinNotes] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [availRes, myRes] = await Promise.all([
        getEquipment({ siteId: profile.assignedSiteId, status: 'available' }),
        getMyActiveEquipment(profile.uid),
      ]);
      setEquipment(availRes.data);
      setMyEquipment(myRes.data);
    } catch {}
    finally { setLoading(false); }
  };

  const handleCheckout = async (item) => {
    Alert.alert(
      `Check Out: ${item.name}`,
      `Are you sure you want to check out this ${item.typeName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Check Out', onPress: async () => {
            try {
              await checkoutEquipment(item.id, { siteId: profile.assignedSiteId });
              await loadData();
              Alert.alert('', `${item.name} checked out to you`);
            } catch (err) {
              Alert.alert('Error', err.response?.data?.error || 'Could not check out equipment');
            }
          }
        }
      ]
    );
  };

  const openCheckin = (item) => {
    setSelectedEquip(item);
    setCheckinCondition('good');
    setCheckinNotes('');
    setShowCheckinModal(true);
  };

  const handleCheckin = async () => {
    try {
      await checkinEquipment(selectedEquip.id, {
        condition: checkinCondition,
        notes: checkinNotes,
      });
      setShowCheckinModal(false);
      await loadData();
      Alert.alert('', `${selectedEquip.name} returned successfully`);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Could not check in equipment');
    }
  };

  const renderEquipItem = ({ item }) => (
    <View style={styles.equipCard}>
      <View style={styles.equipInfo}>
        <Text style={styles.equipName}>{item.name}</Text>
        <Text style={styles.equipType}>{item.typeName}</Text>
        {item.make ? <Text style={styles.equipDetail}>{item.make} {item.model}</Text> : null}
        {item.serialNumber ? <Text style={styles.equipDetail}>S/N: {item.serialNumber}</Text> : null}
        {item.licensePlate ? <Text style={styles.equipDetail}>Plate: {item.licensePlate}</Text> : null}
      </View>
      <View style={styles.equipActions}>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[item.status] }]}>
          <Text style={styles.statusText}>{STATUS_LABEL[item.status]}</Text>
        </View>
        {item.status === 'available' && (
          <TouchableOpacity style={styles.checkoutBtn} onPress={() => handleCheckout(item)}>
            <Text style={styles.checkoutBtnText}>Check Out</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderMyEquipItem = ({ item }) => (
    <View style={[styles.equipCard, { borderLeftColor: '#1565c0', borderLeftWidth: 4 }]}>
      <View style={styles.equipInfo}>
        <Text style={styles.equipName}>{item.name}</Text>
        <Text style={styles.equipType}>{item.typeName}</Text>
        {item.make ? <Text style={styles.equipDetail}>{item.make} {item.model}</Text> : null}
        <Text style={styles.checkedOutTime}>
          Since: {item.assignedAt ? new Date(item.assignedAt).toLocaleTimeString() : '-'}
        </Text>
      </View>
      <TouchableOpacity style={styles.checkinBtn} onPress={() => openCheckin(item)}>
        <Text style={styles.checkinBtnText}>Return</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Equipment</Text>
        <TouchableOpacity onPress={loadData}>
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'available' && styles.tabActive]}
          onPress={() => setActiveTab('available')}
        >
          <Text style={[styles.tabText, activeTab === 'available' && styles.tabTextActive]}>
            Available ({equipment.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'mine' && styles.tabActive]}
          onPress={() => setActiveTab('mine')}
        >
          <Text style={[styles.tabText, activeTab === 'mine' && styles.tabTextActive]}>
            My Equipment ({myEquipment.length})
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#1a237e" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={activeTab === 'available' ? equipment : myEquipment}
          keyExtractor={item => item.id}
          renderItem={activeTab === 'available' ? renderEquipItem : renderMyEquipItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {activeTab === 'available'
                ? 'No equipment available on this site'
                : 'You have no equipment checked out'}
            </Text>
          }
        />
      )}

      {/* Check In Modal */}
      <Modal visible={showCheckinModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Return: {selectedEquip?.name}</Text>
            <Text style={styles.modalLabel}>Condition when returning:</Text>

            {CONDITION_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.conditionOption,
                  checkinCondition === opt.value && { borderColor: opt.color, backgroundColor: opt.color + '15' }
                ]}
                onPress={() => setCheckinCondition(opt.value)}
              >
                <View style={[styles.conditionDot, { backgroundColor: opt.color }]} />
                <Text style={[styles.conditionText, checkinCondition === opt.value && { color: opt.color, fontWeight: 'bold' }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}

            <TextInput
              style={styles.notesInput}
              placeholder="Notes (optional)"
              value={checkinNotes}
              onChangeText={setCheckinNotes}
              multiline
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCheckinModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={handleCheckin}>
                <Text style={styles.confirmBtnText}>Confirm Return</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  refreshText: { color: '#aab2e8', fontSize: 14 },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  tab: { flex: 1, padding: 14, alignItems: 'center' },
  tabActive: { borderBottomWidth: 3, borderBottomColor: '#1a237e' },
  tabText: { fontSize: 14, color: '#888' },
  tabTextActive: { color: '#1a237e', fontWeight: 'bold' },
  list: { padding: 16 },
  equipCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    elevation: 2,
  },
  equipInfo: { flex: 1 },
  equipName: { fontSize: 16, fontWeight: 'bold', color: '#1a237e' },
  equipType: { fontSize: 13, color: '#888', marginTop: 2 },
  equipDetail: { fontSize: 12, color: '#aaa', marginTop: 2 },
  checkedOutTime: { fontSize: 12, color: '#1565c0', marginTop: 4, fontWeight: '600' },
  equipActions: { alignItems: 'flex-end', gap: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  checkoutBtn: {
    backgroundColor: '#1565c0', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
  },
  checkoutBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  checkinBtn: {
    backgroundColor: '#2e7d32', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
  },
  checkinBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  emptyText: { textAlign: 'center', color: '#aaa', marginTop: 60, fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24,
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#1a237e', marginBottom: 16 },
  modalLabel: { fontSize: 14, color: '#666', marginBottom: 10 },
  conditionOption: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    borderRadius: 10, borderWidth: 1.5, borderColor: '#ddd', marginBottom: 8,
  },
  conditionDot: { width: 12, height: 12, borderRadius: 6, marginRight: 10 },
  conditionText: { fontSize: 15, color: '#333' },
  notesInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12,
    marginTop: 8, marginBottom: 16, minHeight: 60, fontSize: 14,
  },
  modalButtons: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, padding: 14, backgroundColor: '#f5f5f5', borderRadius: 10, alignItems: 'center' },
  cancelBtnText: { fontSize: 15, color: '#333', fontWeight: '600' },
  confirmBtn: { flex: 1, padding: 14, backgroundColor: '#1a237e', borderRadius: 10, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
});
