# OverlayChat — Security Recommendations

A full audit of the codebase covering the four issues raised, plus additional findings from reviewing `database.rules.json`, `host.js`, `firebase.js`, `audience.js`, and `shared.js`.

---

## 🔴 Critical Issues

### 1. `/h` (Host Console) is Publicly Accessible

**Current state:** Anyone who knows the URL `vrccim.com/h` can reach the host console and:
- Change the match title and teams
- Lock/unlock predictions for everyone
- Clear all predictions and chat history
- Toggle re-prediction settings

**Root cause:** Firebase Hosting has no concept of server-side auth for static pages. The `/h` rewrite just serves `host.html` to everyone.

**The only real fix: Firebase Auth on the host page.**

#### Recommended fix — Google Sign-In with an allowlist

This is the cleanest solution for a small admin group with zero backend cost.

**Step 1 — Enable Google Auth in Firebase Console**  
`Firebase Console → Authentication → Sign-in method → Google → Enable`

**Step 2 — Add an `admins` node to your database rules**
```json
{
  "rules": {
    "admins": {
      ".read": "auth != null",
      ".write": false
    },
    "rooms": { ... }
  }
}
```
Manually add admin UIDs in Firebase Console under Realtime Database:
```
admins/
  UID_OF_AKSHAT: true
  UID_OF_VXT: true
```

**Step 3 — Gate `host.js` behind auth**
```js
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "...";
import { get, ref } from "...";

const auth = getAuth();
const provider = new GoogleAuthProvider();

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Show login button, hide entire host UI
    showLoginScreen();
    return;
  }

  // Check if UID is in admins allowlist
  const snap = await get(ref(db, `admins/${user.uid}`));
  if (!snap.exists()) {
    showAccessDenied(user.displayName);
    auth.signOut();
    return;
  }

  // Render host console
  initHostConsole();
});
```

**Step 4 — Lock Firebase DB writes to auth'd admins**
```json
"meta": {
  ".read": true,
  ".write": "auth != null && root.child('admins').child(auth.uid).exists()"
},
"chat": {
  ".read": true,
  ".write": true  // Keep open for viewers
}
```

> [!IMPORTANT]
> Until this is done, **any viewer can call `saveRoomMeta()` directly from the browser console** because the Firebase DB rules currently allow unauthenticated writes to `meta`.

---

### 2. Unauthenticated Writes to All DB Nodes

**Current `database.rules.json`:**
```json
"meta": { ".write": true },
"season_leaderboard": { ".write": true },
"history": { ".write": true },
"innings_history": { ".write": true }
```

**Impact:** Anyone with the Firebase config keys (which are in `firebase-config.js`, served publicly) can:
- Overwrite the season leaderboard with fake scores
- Delete/corrupt all match history
- Write arbitrary data to `meta` to lock out predictions

**Fix — tiered write rules:**

| Node | Who can write |
|---|---|
| `meta` | Admin (auth'd, in allowlist) |
| `chat` | Anyone (authenticated viewer ideally) |
| `predictions/$clientId` | Anyone — but validate shape strictly |
| `season_leaderboard` | Admin only (monitor bot service account) |
| `history` | Admin only |
| `innings_history` | Admin only |
| `reaction` | Anyone |
| `active_sessions` | Anyone |

```json
{
  "rules": {
    "admins": {
      ".read": "auth != null",
      ".write": false
    },
    "rooms": {
      "$roomId": {
        "meta": {
          ".read": true,
          ".write": "auth != null && root.child('admins').child(auth.uid).exists()"
        },
        "chat": {
          ".read": true,
          ".write": true,
          "$messageId": {
            ".validate": "newData.child('name').isString() && newData.child('name').val().length <= 40 && newData.child('message').isString() && newData.child('message').val().length <= 500"
          }
        },
        "predictions": {
          ".read": true,
          "$clientId": {
            ".write": "$clientId === auth.uid || auth == null",
            ".validate": "newData.val() == null || (newData.hasChildren(['clientId','name','predictedWinner','updatedAt']) && newData.child('name').val().length <= 40)"
          }
        },
        "season_leaderboard": {
          ".read": true,
          ".write": "auth != null && root.child('admins').child(auth.uid).exists()"
        },
        "history": {
          ".read": true,
          ".write": "auth != null && root.child('admins').child(auth.uid).exists()"
        },
        "innings_history": {
          ".read": true,
          ".write": "auth != null && root.child('admins').child(auth.uid).exists()"
        },
        "reaction": {
          ".read": true,
          ".write": true
        }
      }
    },
    "active_sessions": {
      ".read": true,
      "$roomId": {
        ".write": true
      }
    }
  }
}
```

> [!NOTE]
> The `monitor.js` GitHub Actions bot writes to `season_leaderboard`, `history`, and `meta`. It should use a **Firebase Admin SDK service account** (already uses the `serviceAccountKey.json`), which bypasses all rules — so tightening rules does NOT break the bot.

---

## 🟠 High Priority Issues

### 3. Username Identity — "Aye Saurabh" vs "Saurabh" are treated as different players

**Current state:** Identity is a free-text name field stored in `localStorage`. There is no concept of a persistent account. The "Restore Session" feature can fuzzy-match by name, but:
- Different capitalisation = different player
- Typos = duplicate entries
- Anyone can type someone else's name and steal their session reference

**The right long-term fix: Firebase Anonymous Auth + display name**

Firebase Anonymous Auth gives every browser a stable, server-generated UID without requiring a password. The name becomes just a display label.

```js
// shared.js
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

export const getClientId = async () => {
  const auth = getAuth();
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        resolve(user.uid); // stable UID from Firebase
      } else {
        const cred = await signInAnonymously(auth);
        resolve(cred.user.uid);
      }
    });
  });
};
```

Benefits:
- UID is stable across sessions on the same browser (Firebase persists it in IndexedDB)
- If user clears storage, they get a new UID — but you can offer "link to Google account" to make it permanent
- The `predictions/$clientId` DB path becomes `predictions/$uid` — same code, but now `$uid` is server-issued
- Name is stored separately from identity

**Shorter-term pragmatic fix (no auth required):**
- Store clientId in `localStorage` (already done ✅)
- On name submission, normalize: `name.trim().toLowerCase()` for lookup, store original capitalisation for display
- Show a "this name is already taken — is this you?" restore prompt when a new session types a matching normalized name (you already have partial logic for this at line 629 of `audience.js`)

---

### 4. Admin Audit Logging

**Current state:** No record of who changed what or when on the host console.

**Recommended fix:** Write an `admin_log` node on every host action.

```js
// In host.js, wrap every admin action:
const logAdminAction = async (action, details = {}) => {
  const logRef = push(ref(db, `admin_log/${roomId}`));
  await set(logRef, {
    action,
    ...details,
    uid: auth.currentUser?.uid,
    displayName: auth.currentUser?.displayName,
    at: serverTimestamp()
  });
};

// Example usage:
await saveRoomMeta(roomId, { matchTitle, teamA, teamB });
await logAdminAction("save_meta", { matchTitle, teamA, teamB });

await clearRoomNode(roomId, "predictions");
await logAdminAction("clear_predictions");
```

DB rules for the log — append-only, admin-read:
```json
"admin_log": {
  "$roomId": {
    ".read": "auth != null && root.child('admins').child(auth.uid).exists()",
    ".write": "auth != null && root.child('admins').child(auth.uid).exists()",
    "$logId": {
      ".write": "!data.exists()" // Append-only: can create, cannot overwrite
    }
  }
}
```

---

## 🟡 Medium Priority Issues

### 5. Firebase Config Keys Are Exposed in Public JS

**Current state:** `firebase-config.js` is served publicly and contains `apiKey`, `projectId`, `databaseURL`, etc.

**Reality check:** For Firebase, the `apiKey` is NOT a secret — it's a project identifier. The actual security is enforced by **Firebase Security Rules** (addressed above) and optionally App Check.

**Recommended mitigations:**
- **Firebase App Check** — restricts API access to requests originating from your registered web app. Enable in Firebase Console → App Check → Web → reCAPTCHA v3. This stops scripts running outside your domain from abusing your DB even with the config keys.
- **Authorized Domains** — in Firebase Console → Authentication → Settings → Authorized Domains, ensure only `vrccim.com` and `localhost` are listed.
- **Database URL restriction** — in Google Cloud Console, restrict the API key to only the services you use (Realtime Database, Hosting).

---

### 6. No Rate Limiting on Chat / Predictions

**Current state:** A malicious user could write a loop to flood the chat or predictions node with thousands of entries per minute.

**Fixes:**
- **Firebase Security Rules rate limiting** — not natively supported, but you can use a write-blocking rule with timestamp throttling:
  ```json
  "chat": {
    "$messageId": {
      ".validate": "newData.child('createdAt').val() >= now - 2000"
    }
  }
  ```
  This doesn't prevent volume, but makes stale timestamp injections fail.
- **Firebase App Check** (see above) is the strongest protection here without a backend.
- **Cloud Function rate limiter** — if you ever add a backend, a Cloud Function can enforce per-user rate limits before writing to the DB.

---

### 7. GIF API Key Exposed in Client-Side JS

**Current state (`audience.js` line 97):**
```js
const KLIPY_API_KEY = "rwGYYILu8ZBT9xFPoSG2jUhq65JqUbryTlm4JXs8dWXxmR5GgGbEn5nrgvNxRCud";
```

This key is fully visible in the browser network tab and source code. Anyone can copy and use it in their own app.

**Mitigations:**
- Check Klipy's dashboard for domain restrictions — whitelist `vrccim.com` only.
- If Klipy supports it, use referrer-locked API keys.
- Move the key behind a Firebase Cloud Function proxy if abuse becomes a concern.

---

### 8. Missing Content Security Policy (CSP) Header

**Current state:** No CSP headers are set in `firebase.json`. This means the browser will load scripts/styles from any origin, increasing XSS risk.

**Recommended addition to `firebase.json`:**
```json
{
  "key": "Content-Security-Policy",
  "value": "default-src 'self'; script-src 'self' https://www.gstatic.com https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; img-src 'self' data: https://*.klipy.com https://*.klipy.co; connect-src 'self' https://*.firebaseio.com wss://*.firebaseio.com https://api.klipy.com; font-src 'self' https://fonts.gstatic.com;"
}
```

> [!WARNING]
> Firebase Realtime Database uses WebSockets (`wss://`) so `connect-src` must include `wss://*.firebaseio.com`. Test thoroughly after adding — an overly strict CSP will break Firebase listeners.

---

## 🟢 Low Priority / Best Practices

### 9. Prediction Payload Has No Server-Side Validation of Score Ranges

**Current state:** The DB rule validates `hasChildren(['clientId','name','predictedWinner','updatedAt'])` but does not validate score values. Someone can write `scoreA: 9999` directly to Firebase.

**Add to rules:**
```json
"$clientId": {
  ".validate": "newData.hasChildren(['clientId','name','predictedWinner','updatedAt']) && newData.child('name').val().length <= 40 && (newData.child('scoreA').val() == null || (newData.child('scoreA').isNumber() && newData.child('scoreA').val() >= 0 && newData.child('scoreA').val() <= 300)) && (newData.child('scoreB').val() == null || (newData.child('scoreB').isNumber() && newData.child('scoreB').val() >= 0 && newData.child('scoreB').val() <= 300))"
}
```

---

### 10. `clientId` Is Trivially Forgeable

**Current state:** `clientId` is generated as `viewer-{random}` and stored in `localStorage`. It is written into the prediction payload by the client.

The DB path `predictions/$clientId` uses this value as the key. There is no rule preventing a client from writing to `predictions/viewer-someoneselseid`.

**Fix with Firebase Auth (see Issue #3):** When UIDs come from Firebase Auth, the rule `"$uid === auth.uid"` makes this impossible. Without auth, this is hard to solve.

---

## Implementation Priority Order

| # | Issue | Effort | Impact |
|---|---|---|---|
| 1 | Lock `/h` with Firebase Google Auth | Medium | 🔴 Critical |
| 2 | Tighten DB write rules (meta, leaderboard, history) | Low | 🔴 Critical |
| 3 | Add Admin Audit Log | Low | 🟠 High |
| 4 | Firebase Anonymous Auth for stable UIDs | Medium | 🟠 High |
| 5 | Firebase App Check (stops key abuse) | Low | 🟡 Medium |
| 6 | CSP headers in firebase.json | Low | 🟡 Medium |
| 7 | Score range validation in DB rules | Low | 🟢 Low |
| 8 | Klipy key domain restriction | Minimal | 🟢 Low |

---

## Quick Win — DB Rules Tightening (Zero Code Changes)

The single highest-impact/lowest-effort change is updating `database.rules.json`. This can be done right now without touching any JS:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        "meta": {
          ".read": true,
          ".write": false
        },
        "chat": {
          ".read": true,
          ".write": true,
          "$messageId": {
            ".validate": "newData.val() == null || (newData.child('name').isString() && newData.child('name').val().length <= 40 && newData.child('message').isString() && newData.child('message').val().length <= 500)"
          }
        },
        "predictions": {
          ".read": true,
          ".write": true,
          "$clientId": {
            ".validate": "newData.val() == null || (newData.hasChildren(['clientId', 'name', 'predictedWinner', 'updatedAt']) && newData.child('name').val().length <= 40)"
          }
        },
        "innings_history": { ".read": true, ".write": false },
        "history": { ".read": true, ".write": false },
        "season_leaderboard": { ".read": true, ".write": false },
        "reaction": { ".read": true, ".write": true }
      }
    },
    "active_sessions": {
      ".read": true,
      "$roomId": { ".write": true }
    }
  }
}
```

> [!CAUTION]
> Setting `meta/.write: false` means the host console will **break** until you add Firebase Auth. The `monitor.js` bot uses the **Admin SDK** and is exempt from these rules — it will keep working fine. You need to ship the Auth gating on `/h` at the same time as this DB rules change.
