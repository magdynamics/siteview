import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyCf1DsG48iQf_GDhaAkKOkCnU6IffyUlCI',
  authDomain: 'siteview-buildchain.firebaseapp.com',
  projectId: 'siteview-buildchain',
  storageBucket: 'siteview-buildchain.firebasestorage.app',
  messagingSenderId: '1081062560185',
  appId: '1:1081062560185:web:50e59c7eb1602718a16668',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
