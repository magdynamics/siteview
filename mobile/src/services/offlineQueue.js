import AsyncStorage from '@react-native-async-storage/async-storage';

// Offline-first queue (technical guideline §10.1): job sites have poor
// connectivity. Queueable mutations that fail with a network error are
// stored locally and replayed when a connection returns. Photo uploads
// (multipart) are not queueable — they need live connectivity.

const KEY = 'siteview_offline_queue_v1';

export async function enqueue(entry) {
  const q = JSON.parse((await AsyncStorage.getItem(KEY)) || '[]');
  q.push(entry);
  await AsyncStorage.setItem(KEY, JSON.stringify(q));
  return q.length;
}

export async function pendingCount() {
  return JSON.parse((await AsyncStorage.getItem(KEY)) || '[]').length;
}

// Replays queued mutations. A server response (even an error status) means
// the network is back and the entry reached the server — it is dropped
// either way; only pure network failures stay queued.
export async function flush(api) {
  const q = JSON.parse((await AsyncStorage.getItem(KEY)) || '[]');
  if (!q.length) return 0;
  const remaining = [];
  let delivered = 0;
  for (const e of q) {
    try {
      await api.request({ method: e.method, url: e.url, data: e.data, __fromQueue: true });
      delivered++;
    } catch (err) {
      if (err.response) delivered++;   // reached the server; server said no — don't retry forever
      else remaining.push(e);
    }
  }
  await AsyncStorage.setItem(KEY, JSON.stringify(remaining));
  return delivered;
}
