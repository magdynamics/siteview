import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from './en';
import es from './es';

i18n.use(initReactI18next).init({
  resources: { en, es },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export const setLanguage = async (lang) => {
  await AsyncStorage.setItem('language', lang);
  i18n.changeLanguage(lang);
};

export const loadSavedLanguage = async () => {
  const lang = await AsyncStorage.getItem('language');
  if (lang) i18n.changeLanguage(lang);
};

export default i18n;
