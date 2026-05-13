# Firebase Setup — Cross-Device Sync

This walks you through enabling **shared data across devices** so your parents can both use the dashboard from different computers and see the same numbers.

**Time required:** ~15 minutes
**Cost:** $0 forever (free tier is more than enough for a family)
**Difficulty:** Click-through, no coding required

When you're done, opening the URL on your laptop, your mom's computer, and your dad's phone will all show the same data. Editing on one device updates the others within seconds.

---

## Part 1 — Create the Firebase project (5 minutes)

### Step 1.1 — Go to Firebase

1. Open [console.firebase.google.com](https://console.firebase.google.com) in your browser
2. Sign in with your Google account (any Gmail works)
3. You'll see the Firebase console

### Step 1.2 — Create a project

1. Click **"Add project"** (big card with a plus icon)
2. Project name: `parents-retirement` (or anything you like)
3. Click **Continue**
4. **Disable** Google Analytics (toggle off the switch) — you don't need it for this
5. Click **Create project**
6. Wait ~30 seconds for it to provision
7. Click **Continue** when it's done

You're now in the project dashboard.

---

## Part 2 — Set up the database (5 minutes)

### Step 2.1 — Enable Firestore

1. In the left sidebar, look for **Build** → click it to expand
2. Click **Firestore Database**
3. Click the **Create database** button
4. A dialog pops up. Choose:
   - **Location:** Pick the one closest to you (e.g., `us-central` if you're in the US). This can't be changed later.
   - Click **Next**
5. **Security rules:** Choose **Start in test mode**
   - This sets a 30-day open-access window — fine for getting started
   - We'll harden it in Part 4
6. Click **Create**
7. Wait ~30 seconds

You now have a database. The empty page is fine — your dashboard will create the data automatically.

---

## Part 3 — Get the config values (3 minutes)

### Step 3.1 — Register a web app

1. Click the gear icon ⚙️ next to "Project Overview" at the top-left
2. Click **Project settings**
3. Scroll down to **Your apps** section
4. Click the **`</>`** icon (web app)
5. App nickname: `retirement-dashboard` (anything works)
6. **Don't check** "Also set up Firebase Hosting"
7. Click **Register app**

### Step 3.2 — Copy the config

You'll now see a code block that looks like this:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyB1234567890abcdefghijk",
  authDomain: "parents-retirement.firebaseapp.com",
  projectId: "parents-retirement",
  storageBucket: "parents-retirement.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123def456",
};
```

**Keep this tab open** — you'll need these values in a second.

Click **Continue to console** to dismiss the dialog (you can always view these values again later via Project settings).

---

## Part 4 — Paste config into your project (2 minutes)

### Step 4.1 — Open the firebase.js file

In your project folder, open `src/firebase.js` in any text editor (Notepad, VS Code, TextEdit — anything).

### Step 4.2 — Replace the placeholders

Near the top of the file you'll see:

```javascript
const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY_HERE",
  authDomain: "PASTE_YOUR_AUTH_DOMAIN_HERE",
  projectId: "PASTE_YOUR_PROJECT_ID_HERE",
  storageBucket: "PASTE_YOUR_STORAGE_BUCKET_HERE",
  messagingSenderId: "PASTE_YOUR_SENDER_ID_HERE",
  appId: "PASTE_YOUR_APP_ID_HERE",
};
```

Replace each `"PASTE_YOUR_..."` value with the matching value from Firebase. Keep the quotes around each value.

**It should end up looking like:**

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyB1234567890abcdefghijk",
  authDomain: "parents-retirement.firebaseapp.com",
  projectId: "parents-retirement",
  storageBucket: "parents-retirement.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123def456",
};
```

Save the file.

### Step 4.3 — Push to GitHub

1. Open GitHub Desktop
2. You'll see `src/firebase.js` listed as a changed file
3. Type a summary: `Add Firebase config`
4. Click **Commit to main**
5. Click **Push origin**

Vercel will auto-deploy within ~30 seconds. Refresh your parents' URL — you should now see **"● Synced across devices"** in the top-right corner instead of "Local only".

---

## Part 5 — Lock down security (3 minutes, optional but recommended)

Test mode lets anyone with your project ID write data, and it expires after 30 days. Let's tighten it.

### Step 5.1 — Open Firestore rules

1. Back in the Firebase console, go to **Firestore Database** in the left sidebar
2. Click the **Rules** tab at the top

### Step 5.2 — Replace the rules

You'll see something like:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.time < timestamp.date(2025, 12, 31);
    }
  }
}
```

Replace the whole thing with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Only the one household document is accessible — and only without auth
    // because anyone with the URL is trusted (the URL is the secret).
    match /households/household_v1 {
      allow read, write: if true;
    }
  }
}
```

Click **Publish**. This locks down everything except the one document your dashboard uses, and doesn't expire.

---

## Done!

When you open the dashboard, you should see **"● Synced across devices"** in the top-right corner. Make a change on one device, and it appears on all other devices within seconds.

### What this means in practice

- ✅ Your mom can enter all 6 properties on her laptop
- ✅ Your dad opens the URL on his computer → sees those properties already filled in
- ✅ You change a slider on your phone → both their devices update in real time
- ✅ No more "which device has the latest version?"

### What's still safe

- The URL is the secret. Anyone with the URL has full read/write access. Don't post the link on social media.
- This is fine for a small family using a hard-to-guess Vercel URL. If you ever wanted to share with a broader group, we'd add real auth.

### Troubleshooting

**Header still shows "Local only" after deploying** → The Firebase config values aren't right. Double-check that all 6 values were copied without typos and that the file was saved before pushing.

**"Sync error" in the header** → Check the Firestore rules (Part 5). The dashboard needs read+write access to `households/household_v1`.

**Need to start over with fresh data** → In Firestore Database, find the `households` collection, click the `household_v1` document, and delete it. The dashboard will recreate it with default values next time it saves.

**Want to see what's stored** → In Firestore Database in the Firebase console, click the `households` collection → click `household_v1`. You'll see the JSON of every property, lever, lump payment, and acquisition. Useful for debugging or backing up data manually.
