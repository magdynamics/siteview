# SiteView — Build Chain
## Developer Setup Guide

---

## Project Structure

```
siteview/
├── backend/         Node.js API server
├── mobile/          React Native mobile app (iOS + Android)
├── web/             React.js web dashboard
├── firebase/        Firebase security rules
└── SETUP_GUIDE.md   This file
```

---

## Step 1: Firebase Setup

1. Go to https://console.firebase.google.com
2. Click "Add project" → name it "siteview-buildchain"
3. Enable these services:
   - **Authentication** → Email/Password
   - **Firestore Database** → Start in production mode
   - **Storage** → Start in production mode
   - **Cloud Messaging** (for push notifications)

4. Get your Firebase config:
   - Project Settings → General → Your apps → Add Web App
   - Copy the firebaseConfig object

5. Get your service account key (for backend):
   - Project Settings → Service Accounts → Generate new private key
   - Save as `backend/serviceAccountKey.json`

6. Deploy Firestore rules:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase deploy --only firestore:rules,storage
   ```

---

## Step 2: Backend Setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env` with your values:
```
FIREBASE_PROJECT_ID=siteview-buildchain
FIREBASE_PRIVATE_KEY=<from service account key>
FIREBASE_CLIENT_EMAIL=<from service account key>
FIREBASE_STORAGE_BUCKET=siteview-buildchain.appspot.com
GOOGLE_MAPS_API_KEY=<from Google Cloud Console>
PORT=5000
```

Start the server:
```bash
npm run dev
```

Deploy to production: Use **Google Cloud Run**, **Railway**, or **Render**

---

## Step 3: Web Dashboard Setup

```bash
cd web
npm install
```

Create `web/.env`:
```
REACT_APP_API_URL=http://localhost:5000/api
```

Replace Firebase config in `web/src/services/firebase.js` with your config.

Start dashboard:
```bash
npm start
```

Build for production:
```bash
npm run build
firebase deploy --only hosting
```

---

## Step 4: Mobile App Setup

```bash
cd mobile
npm install
npm install -g expo-cli
```

Replace Firebase config in `mobile/src/services/firebase.js`.

Replace API_URL in `mobile/src/services/api.js` with your backend URL.

Run on device:
```bash
expo start
```
- Scan QR code with Expo Go app (iOS/Android)
- For production: `expo build:ios` and `expo build:android`

---

## Step 5: Create First Admin User

1. Go to Firebase Console → Authentication → Add user
2. Add email: admin@buildchain.com, set a password
3. Go to Firestore → Create document in `users` collection:
   ```json
   {
     "uid": "<copy from Firebase Auth>",
     "name": "Admin",
     "email": "admin@buildchain.com",
     "role": "admin",
     "isActive": true
   }
   ```
4. Login at your web dashboard → Admin panel → Add sites and employees

---

## User Roles

| Role | Access |
|------|--------|
| `employee` | Mobile app only |
| `supervisor` | Web dashboard — live status, timesheet approval, manual punch |
| `accountant` | Web dashboard — timesheets, invoices, export, documents |
| `manager` | Web dashboard — all sites overview, weekly reports |
| `admin` | Everything + manage employees and sites |

---

## Payment Types

When creating an employee, set:
- `paymentType: "hourly"` → set `hourlyRate`
- `paymentType: "daily"` → set `dailyRate`
- `paymentType: "contract"` → set `contractAmount`

---

## Languages Supported

- English (`en`)
- Spanish (`es`)

Employees can switch language in their profile on the mobile app.

---

## Support

For technical questions, share error messages from:
- Backend: terminal logs
- Mobile: Expo developer tools
- Web: browser developer console (F12)
