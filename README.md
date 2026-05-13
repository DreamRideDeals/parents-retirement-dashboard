# Retirement Dashboard

A personalized retirement planning dashboard for tracking 6 rental properties, modeling snowball paydown, and figuring out the path to a target monthly cash flow.

---

## Quick start (run on your computer first)

Before deploying, it's a good idea to make sure it works on your machine.

### Prerequisites
- **Node.js** installed. Check by running `node --version` in a terminal — you need v18 or higher. If you don't have it, download from [nodejs.org](https://nodejs.org) (LTS version).

### Steps
1. Open a terminal in this folder.
2. Run `npm install` (downloads dependencies, ~30 seconds).
3. Run `npm run dev`.
4. Open the URL it prints (usually `http://localhost:5173`).

You should see the dashboard. Click around, add some properties, change some sliders. The data saves in your browser's localStorage.

---

## Deploying to Vercel (so your parents can use it)

This gives you a real website at a URL like `parents-retirement.vercel.app`. Free forever, automatic updates whenever you change the code.

### Step 1 — Create a GitHub account (if you don't have one)

1. Go to [github.com](https://github.com)
2. Click **Sign up** in the top-right
3. Create an account with your email. Free.

### Step 2 — Install GitHub Desktop (the easy way)

GitHub has a command-line tool, but for first-timers, the desktop app is much simpler.

1. Download from [desktop.github.com](https://desktop.github.com) and install.
2. Open it. Sign in with the GitHub account you just made.

### Step 3 — Create a new repository

1. In GitHub Desktop, click **File → New Repository...**
2. Give it a name like `retirement-dashboard` (lowercase, no spaces).
3. For **Local path**, choose where to put it on your computer (e.g., `Documents/`). It will create a folder with your repo name inside.
4. Leave the other fields default. Click **Create Repository**.

### Step 4 — Copy the project files into the repo folder

1. The folder GitHub Desktop just created is empty (well, has a hidden `.git` folder).
2. Copy ALL the files from this project folder INTO that new folder. The structure should look like:
   ```
   retirement-dashboard/
   ├── .git/                    (created by GitHub Desktop, leave alone)
   ├── src/
   │   ├── App.jsx
   │   ├── main.jsx
   │   └── index.css
   ├── index.html
   ├── package.json
   ├── postcss.config.js
   ├── tailwind.config.js
   ├── vite.config.js
   ├── .gitignore
   └── README.md
   ```
3. Back in GitHub Desktop, you'll see a list of changed files (all the ones you just copied). Good.

### Step 5 — Commit and push to GitHub

1. In GitHub Desktop, at the bottom-left, type a "Summary" — something like `Initial commit`.
2. Click **Commit to main** (the blue button).
3. Now click **Publish repository** at the top. A dialog will pop up.
4. **UNCHECK "Keep this code private"** if you want to use Vercel's free tier easily (or keep it private — Vercel works either way).
5. Click **Publish Repository**. Done — your code is on GitHub.

### Step 6 — Deploy to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Click **Sign Up** → choose **Continue with GitHub**. Authorize it.
3. After signup, you'll see a dashboard. Click **Add New... → Project**.
4. Vercel shows a list of your GitHub repos. Find **retirement-dashboard** and click **Import**.
5. **Don't change any settings.** Vercel auto-detects it's a Vite project. Just click **Deploy** at the bottom.
6. Wait ~1 minute. You'll see a celebration screen with confetti.
7. Click **Continue to Dashboard** or click the preview screenshot.
8. At the top of the project page, you'll see your URL — something like `retirement-dashboard-abc123.vercel.app`. **That's the link to send your parents.**

### Step 7 — (Optional) Get a nicer URL

The default Vercel URL is functional but ugly. To customize:

1. In your Vercel project, click **Settings** → **Domains**.
2. Type a name like `parents-retirement` and click **Add**. If it's available, it becomes `parents-retirement.vercel.app`.
3. Click **Save**.

---

## Updating the app later

When you want to change something:

1. Edit the files on your computer.
2. Open GitHub Desktop. It shows what you changed.
3. Type a summary like "Updated rent assumption", click **Commit to main**, then click **Push origin**.
4. Vercel automatically detects the push and redeploys within ~30 seconds. Your parents' URL updates automatically.

---

## How the app stores data

By default, all data saves to **the browser's localStorage** on whichever device opens the URL. This means data persists across refreshes on that device, but doesn't sync across devices.

**To enable cross-device sync** (so your parents can use it from multiple computers/phones and see the same data), follow the **FIREBASE_SETUP.md** guide. Free, ~15 minutes of clicking.

Once Firebase is set up, you'll see "● Synced across devices" in the dashboard header. Without it, you'll see "○ Local only (this device)".

---

## Troubleshooting

**"npm: command not found"** — You need Node.js installed. Get it from [nodejs.org](https://nodejs.org).

**"npm install" fails** — Make sure you're on Node.js v18+. Run `node --version` to check.

**Vercel deployment fails** — Look at the build log. If it says "no package.json found," you probably copied files into the wrong folder. They should be at the *root* of the repo, not in a subfolder.

**The page is blank** — Open the browser's developer console (right-click → Inspect → Console tab). Errors there will say what's wrong.

---

## What's modeled vs. what isn't

**Modeled:**
- Monthly amortization on each mortgage (real principal/interest split)
- Property appreciation and rent growth compounded monthly
- Operating expenses (tax, insurance, maintenance, vacancy)
- Snowball debt paydown with auto-rolling targets
- Cash flow split between pocket and reinvestment
- Future property acquisitions

**Not modeled:**
- Income tax on rental income (typically heavily offset by depreciation deductions)
- Property management fees (assumes self-management)
- Major capex events (roof, HVAC) — only routine maintenance reserve
- Refinancing existing properties (could be added later)

For an actual retirement decision, consult a CPA who specializes in real estate. This is a planning tool, not financial advice.
