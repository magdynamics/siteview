import axios from 'axios';
import { auth } from './firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = 'http://192.168.1.3:5000/api'; // Dev backend on the office machine's LAN IP

const api = axios.create({ baseURL: API_URL });

// Attach Firebase token to every request
api.interceptors.request.use(async (config) => {
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Punch endpoints
export const punchIn = (data) => api.post('/punches/in', data);
export const punchOut = (data) => api.post('/punches/out', data);
export const getTodayPunches = (employeeId) => api.get(`/punches/today/${employeeId}`);
export const getLiveSite = (siteId) => api.get(`/punches/site/${siteId}/live`);

// Photo endpoints
export const uploadTaskPhoto = (formData) =>
  api.post('/photos/task', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
export const getPhotos = (params) => api.get('/photos', { params });

// Document endpoints
export const uploadDocument = (formData) =>
  api.post('/documents', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
export const getDocuments = (params) => api.get('/documents', { params });

// Employee endpoints
export const getMyProfile = () => api.get('/auth/me');
export const updateFcmToken = (token) => api.post('/auth/fcm-token', { token });
export const updateLanguage = (language) => api.post('/auth/language', { language });

// Sites
export const getSites = () => api.get('/sites');
export const getSite = (id) => api.get(`/sites/${id}`);

// Equipment
export const getEquipmentTypes = () => api.get('/equipment/types');
export const getEquipment = (params) => api.get('/equipment', { params });
export const getMyActiveEquipment = (employeeId) => api.get(`/equipment/employee/${employeeId}/active`);
export const checkoutEquipment = (id, data) => api.post(`/equipment/${id}/checkout`, data);
export const checkinEquipment = (id, data) => api.post(`/equipment/${id}/checkin`, data);

export default api;
