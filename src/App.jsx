import React, { useState, useMemo, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine, Area, AreaChart } from 'recharts';

// ─────────────────────────── helpers ───────────────────────────

function monthlyPI(principal, annualRatePct, years) {
  if (principal <= 0 || years <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}

function amortizeMonth(balance, annualRatePct, monthlyPayment, extraPrincipal = 0) {
  if (balance <= 0) return { balance: 0, interest: 0, principal: 0 };
  const r = annualRatePct / 100 / 12;
  const interest = balance * r;
  let principal = monthlyPayment - interest;
  if (principal < 0) principal = 0;
  let total = principal + extraPrincipal;
  if (total > balance) total = balance;
  return { balance: balance - total, interest, principal: total };
}

const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');
const fmtSigned = (n) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const fmtK = (n) => '$' + Math.round(n / 1000).toLocaleString('en-US') + 'k';
const fmtMo = (n) => '$' + Math.round(n).toLocaleString('en-US') + '/mo';

// ─────────────────────────── seed data ───────────────────────────

const SEED_PROPERTIES = [
  { id: 1, nickname: 'Property 1',  value: 320000, balance: 145000, rate: 4.25, yearsLeft: 22, monthlyRent: 2400, taxRate: 1.1, insRate: 0.6, maintRate: 1.0, vacancy: 5 },
  { id: 2, nickname: 'Property 2',  value: 285000, balance: 198000, rate: 5.50, yearsLeft: 27, monthlyRent: 2200, taxRate: 1.1, insRate: 0.6, maintRate: 1.0, vacancy: 5 },
  { id: 3, nickname: 'Property 3',  value: 410000, balance: 92000,  rate: 3.75, yearsLeft: 14, monthlyRent: 2900, taxRate: 1.1, insRate: 0.6, maintRate: 1.0, vacancy: 5 },
  { id: 4, nickname: 'Property 4',  value: 265000, balance: 165000, rate: 6.25, yearsLeft: 28, monthlyRent: 2050, taxRate: 1.1, insRate: 0.6, maintRate: 1.0, vacancy: 5 },
  { id: 5, nickname: 'Property 5',  value: 350000, balance: 0,      rate: 0,    yearsLeft: 0,  monthlyRent: 2600, taxRate: 1.1, insRate: 0.6, maintRate: 1.0, vacancy: 5 },
  { id: 6, nickname: 'Property 6',  value: 295000, balance: 220000, rate: 6.75, yearsLeft: 29, monthlyRent: 2300, taxRate: 1.1, insRate: 0.6, maintRate: 1.0, vacancy: 5 },
];

// ─────────────────────────── simulation engine ───────────────────────────

function simulate(initialProperties, levers) {
  const {
    horizonYears, appreciation, rentGrowth, extraPrincipalMonthly, snowballTargetId,
    plannedAcquisitions, includeNewProps, cashFlowReinvestPct, lumpPayments,
  } = levers;

  // Initialize each property's state
  const props = initialProperties.map(p => ({
    ...p,
    monthlyPI: monthlyPI(p.balance, p.rate, p.yearsLeft),
    isPaidOff: p.balance <= 0,
    payoffMonth: p.balance <= 0 ? 0 : null,
  }));

  const monthly = []; // month-by-month detail
  const yearly = []; // yearly snapshots
  let snowballTarget = snowballTargetId;

  for (let m = 1; m <= horizonYears * 12; m++) {
    // Add new property if it's acquisition month (month-of-year basis)
    if (includeNewProps) {
      plannedAcquisitions.forEach(acq => {
        if (acq.acquireMonth === m) {
          const newPI = monthlyPI(acq.loanAmount, acq.rate, acq.termYears);
          props.push({
            id: 1000 + acq.id,
            nickname: acq.nickname || `New Property #${acq.id}`,
            value: acq.purchasePrice,
            balance: acq.loanAmount,
            rate: acq.rate,
            yearsLeft: acq.termYears,
            monthlyRent: acq.monthlyRent,
            taxRate: 1.1, insRate: 0.6, maintRate: 1.0, vacancy: 5,
            monthlyPI: newPI,
            isPaidOff: false,
            payoffMonth: null,
            isNew: true,
            acquiredMonth: m,
          });
        }
      });
    }

    // Apply monthly appreciation/rent growth
    const monthlyAppr = Math.pow(1 + appreciation / 100, 1 / 12) - 1;
    const monthlyRentGrowth = Math.pow(1 + rentGrowth / 100, 1 / 12) - 1;

    let totalRentNet = 0;
    let totalOps = 0;
    let totalPI = 0;
    let totalDebt = 0;
    let totalValue = 0;

    // Determine where extra principal goes (snowball)
    let snowballRecipient = null;
    if (extraPrincipalMonthly > 0) {
      // If user picked one, use it (if not paid off). Otherwise smallest non-zero balance.
      const target = props.find(p => p.id === snowballTarget && !p.isPaidOff);
      if (target) {
        snowballRecipient = target;
      } else {
        // Auto-roll to next smallest balance
        const candidates = props.filter(p => !p.isPaidOff && p.balance > 0);
        if (candidates.length > 0) {
          candidates.sort((a, b) => a.balance - b.balance);
          snowballRecipient = candidates[0];
          snowballTarget = snowballRecipient.id;
        }
      }
    }

    props.forEach(prop => {
      // Growth
      prop.value = prop.value * (1 + monthlyAppr);
      prop.monthlyRent = prop.monthlyRent * (1 + monthlyRentGrowth);

      // Operating expenses on a monthly basis (annualized rates / 12)
      const monthlyTax = (prop.value * prop.taxRate / 100) / 12;
      const monthlyIns = (prop.value * prop.insRate / 100) / 12;
      const monthlyMaint = (prop.value * prop.maintRate / 100) / 12;
      const vacancyLoss = prop.monthlyRent * (prop.vacancy / 100);
      const effectiveRent = prop.monthlyRent - vacancyLoss;
      const monthlyOps = monthlyTax + monthlyIns + monthlyMaint;

      // Mortgage payment (with FIXED extra principal from outside income only)
      let monthlyDebtService = 0;
      if (!prop.isPaidOff && prop.balance > 0) {
        const extra = (snowballRecipient && snowballRecipient.id === prop.id) ? extraPrincipalMonthly : 0;
        const result = amortizeMonth(prop.balance, prop.rate, prop.monthlyPI, extra);
        prop.balance = result.balance;
        monthlyDebtService = result.interest + result.principal - extra;
        if (prop.balance <= 0.5) {
          prop.balance = 0;
          prop.isPaidOff = true;
          prop.payoffMonth = m;
        }
        totalPI += monthlyDebtService + extra;
      }

      totalRentNet += effectiveRent;
      totalOps += monthlyOps;
      totalDebt += prop.balance;
      totalValue += prop.value;
    });

    // Gross cash flow this month (rent − ops − all P&I including fixed extra)
    const grossCashFlow = totalRentNet - totalOps - totalPI;

    // Split cash flow: portion reinvested into snowball, portion pocketed.
    // Only positive cash flow can be reinvested; negative stays as a pocket loss.
    let cashFlowToReinvest = 0;
    let cashFlowToPocket = grossCashFlow;
    if (grossCashFlow > 0 && cashFlowReinvestPct > 0) {
      cashFlowToReinvest = grossCashFlow * (cashFlowReinvestPct / 100);
      cashFlowToPocket = grossCashFlow - cashFlowToReinvest;

      // Apply reinvested cash flow to the snowball target
      // Re-pick recipient (could have been paid off in pass 1, OR snowball target may have changed)
      let recipient = props.find(p => p.id === snowballTarget && !p.isPaidOff && p.balance > 0);
      if (!recipient) {
        const candidates = props.filter(p => !p.isPaidOff && p.balance > 0);
        if (candidates.length > 0) {
          candidates.sort((a, b) => a.balance - b.balance);
          recipient = candidates[0];
          if (recipient) snowballTarget = recipient.id;
        }
      }

      if (recipient) {
        let extra = cashFlowToReinvest;
        // If extra exceeds remaining balance, only apply what's needed; rest goes to pocket
        if (extra > recipient.balance) {
          const overflow = extra - recipient.balance;
          extra = recipient.balance;
          cashFlowToPocket += overflow;
          cashFlowToReinvest -= overflow;
        }
        recipient.balance = Math.max(0, recipient.balance - extra);
        totalPI += extra;
        totalDebt -= extra;
        if (recipient.balance <= 0.5) {
          recipient.balance = 0;
          recipient.isPaidOff = true;
          recipient.payoffMonth = m;
        }
      } else {
        // No properties left to pay down — reinvested cash overflows to pocket
        cashFlowToPocket += cashFlowToReinvest;
        cashFlowToReinvest = 0;
      }
    }

    // Apply any one-time lump payments scheduled for this month
    let lumpPaidThisMonth = 0;
    const lumpsThisMonth = (lumpPayments || []).filter(lp => lp.month === m && lp.amount > 0);
    lumpsThisMonth.forEach(lp => {
      // Find recipient: user-specified property if it still has balance, otherwise active snowball target
      let recipient = null;
      if (lp.targetPropertyId) {
        recipient = props.find(p => p.id === lp.targetPropertyId && !p.isPaidOff && p.balance > 0);
      }
      if (!recipient) {
        recipient = props.find(p => p.id === snowballTarget && !p.isPaidOff && p.balance > 0);
      }
      if (!recipient) {
        // Fallback: smallest non-zero balance
        const candidates = props.filter(p => !p.isPaidOff && p.balance > 0);
        if (candidates.length > 0) {
          candidates.sort((a, b) => a.balance - b.balance);
          recipient = candidates[0];
          snowballTarget = recipient.id;
        }
      }

      if (recipient) {
        const applied = Math.min(lp.amount, recipient.balance);
        recipient.balance -= applied;
        totalDebt -= applied;
        lumpPaidThisMonth += applied;
        totalPI += applied;
        if (recipient.balance <= 0.5) {
          recipient.balance = 0;
          recipient.isPaidOff = true;
          recipient.payoffMonth = m;
        }
      }
    });

    const monthlyCashFlow = grossCashFlow; // gross (pre-split) for backward compat
    const totalEquity = totalValue - totalDebt;

    monthly.push({
      month: m,
      year: Math.ceil(m / 12),
      cashFlow: monthlyCashFlow,
      cashFlowPocketed: cashFlowToPocket,
      cashFlowReinvested: cashFlowToReinvest,
      lumpPaid: lumpPaidThisMonth,
      totalDebt,
      totalValue,
      totalEquity,
      activeProps: props.filter(p => !p.isNew || p.acquiredMonth <= m).length,
    });

    // Yearly snapshot at end of year (month 12, 24, 36...)
    if (m % 12 === 0) {
      const year = m / 12;
      const yearStartMonth = m - 11;
      const lumpPaidThisYear = monthly
        .filter(rec => rec.month >= yearStartMonth && rec.month <= m)
        .reduce((s, rec) => s + (rec.lumpPaid || 0), 0);
      yearly.push({
        year,
        cashFlow: monthlyCashFlow,
        cashFlowPocketed: cashFlowToPocket,
        cashFlowReinvested: cashFlowToReinvest,
        annualCashFlow: monthlyCashFlow * 12,
        annualCashFlowPocketed: cashFlowToPocket * 12,
        annualCashFlowReinvested: cashFlowToReinvest * 12,
        lumpPaidThisYear,
        totalDebt,
        totalValue,
        totalEquity,
        propertiesOwned: props.length,
        propertiesPaidOff: props.filter(p => p.isPaidOff).length,
        netRent: totalRentNet,
        netOps: totalOps,
        netPI: totalPI,
        propertySnapshot: props.map(p => ({
          id: p.id,
          nickname: p.nickname,
          value: p.value,
          balance: p.balance,
          isPaidOff: p.isPaidOff,
          monthlyRent: p.monthlyRent,
        })),
      });
    }
  }

  return { yearly, monthly, finalProperties: props };
}

// ─────────────────────────── persistent storage helpers ───────────────────────────
// Two-tier storage: localStorage for instant load, Firebase (if configured) for sync across devices.
// When Firebase is configured, the cloud is the source of truth and localStorage is just a cache.

import { isFirebaseConfigured, cloudLoad, cloudSaveBatch, cloudSubscribe } from './firebase.js';

function loadFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// Save to localStorage only. Cloud saves are debounced and batched separately.
function saveToLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('Local save failed:', e);
  }
}

// ─────────────────────────── main component ───────────────────────────

export default function App() {
  // Load state from storage
  const [properties, setProperties] = useState(SEED_PROPERTIES);
  const [appreciation, setAppreciation] = useState(4.0);
  const [rentGrowth, setRentGrowth] = useState(3.0);
  const [extraPrincipalMonthly, setExtraPrincipalMonthly] = useState(1000);
  const [cashFlowReinvestPct, setCashFlowReinvestPct] = useState(50);
  const [snowballTargetId, setSnowballTargetId] = useState(3);
  const [targetCashFlow, setTargetCashFlow] = useState(15000);
  const [targetYear, setTargetYear] = useState(7);
  const [horizonYears, setHorizonYears] = useState(20);
  const [includeNewProps, setIncludeNewProps] = useState(false);
  const [acquisitions, setAcquisitions] = useState([]);
  const [lumpPayments, setLumpPayments] = useState([]);
  const [storageReady, setStorageReady] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [cloudStatus, setCloudStatus] = useState(isFirebaseConfigured ? 'connecting' : 'local-only');

  // Helper: apply a "levers" object to all the lever-related state setters
  const applyLevers = (lvr) => {
    if (!lvr) return;
    if (lvr.appreciation !== undefined) setAppreciation(lvr.appreciation);
    if (lvr.rentGrowth !== undefined) setRentGrowth(lvr.rentGrowth);
    if (lvr.extraPrincipalMonthly !== undefined) setExtraPrincipalMonthly(lvr.extraPrincipalMonthly);
    if (lvr.cashFlowReinvestPct !== undefined) setCashFlowReinvestPct(lvr.cashFlowReinvestPct);
    if (lvr.snowballTargetId !== undefined) setSnowballTargetId(lvr.snowballTargetId);
    if (lvr.targetCashFlow !== undefined) setTargetCashFlow(lvr.targetCashFlow);
    if (lvr.targetYear !== undefined) setTargetYear(lvr.targetYear);
    if (lvr.horizonYears !== undefined) setHorizonYears(lvr.horizonYears);
    if (lvr.includeNewProps !== undefined) setIncludeNewProps(lvr.includeNewProps);
  };

  // Load on mount: first localStorage (instant), then cloud (authoritative if configured)
  useEffect(() => {
    // Step 1: instant load from localStorage
    const props = loadFromStorage('properties_v1', SEED_PROPERTIES);
    const lvr = loadFromStorage('levers_v1', null);
    const acq = loadFromStorage('acquisitions_v1', []);
    const lumps = loadFromStorage('lumps_v1', []);
    if (props) setProperties(props);
    applyLevers(lvr);
    if (acq) setAcquisitions(acq);
    if (lumps) setLumpPayments(lumps);
    setStorageReady(true);

    // Step 2: if Firebase is configured, fetch cloud data (which may be newer)
    if (isFirebaseConfigured) {
      (async () => {
        try {
          const cloudProps = await cloudLoad('properties_v1', null);
          const cloudLvr = await cloudLoad('levers_v1', null);
          const cloudAcq = await cloudLoad('acquisitions_v1', null);
          const cloudLumps = await cloudLoad('lumps_v1', null);
          if (cloudProps) setProperties(cloudProps);
          if (cloudLvr) applyLevers(cloudLvr);
          if (cloudAcq) setAcquisitions(cloudAcq);
          if (cloudLumps) setLumpPayments(cloudLumps);
          setCloudStatus('connected');
        } catch (e) {
          console.error('Cloud load failed:', e);
          setCloudStatus('error');
        }
      })();

      // Step 3: subscribe to real-time updates — but ignore our own writes
      const unsubscribe = cloudSubscribe((data, isFromUs) => {
        if (isFromUs) return; // Don't echo our own changes back to ourselves
        if (data.properties_v1) setProperties(data.properties_v1);
        if (data.levers_v1) applyLevers(data.levers_v1);
        if (data.acquisitions_v1) setAcquisitions(data.acquisitions_v1);
        if (data.lumps_v1) setLumpPayments(data.lumps_v1);
      });
      return () => unsubscribe();
    }
  }, []);

  // ─── Auto-save: localStorage instantly, cloud every 60 seconds ───
  // Strategy: track when state changes (dirty flag). Every 60 seconds, if dirty, push to cloud.
  // Also save on tab close as a safety net.
  const dirtyRef = useRef(false);
  const lastSavedAtRef = useRef(null);
  const [saveStatus, setSaveStatus] = useState({ dirty: false, lastSavedAt: null, secondsUntilSave: 60 });

  // Build the snapshot once so save handlers and effect all see the same thing
  const buildSnapshot = () => ({
    properties_v1: properties,
    levers_v1: {
      appreciation, rentGrowth, extraPrincipalMonthly, cashFlowReinvestPct, snowballTargetId,
      targetCashFlow, targetYear, horizonYears, includeNewProps,
    },
    acquisitions_v1: acquisitions,
    lumps_v1: lumpPayments,
  });

  // Save to localStorage immediately on every change (free, no quota concerns)
  useEffect(() => {
    if (!storageReady) return;
    const snap = buildSnapshot();
    saveToLocal('properties_v1', snap.properties_v1);
    saveToLocal('levers_v1', snap.levers_v1);
    saveToLocal('acquisitions_v1', snap.acquisitions_v1);
    saveToLocal('lumps_v1', snap.lumps_v1);
    // Mark dirty so the auto-save timer knows there's work to do
    dirtyRef.current = true;
    setSaveStatus(s => ({ ...s, dirty: true }));
  }, [
    properties, acquisitions, lumpPayments,
    appreciation, rentGrowth, extraPrincipalMonthly, cashFlowReinvestPct, snowballTargetId,
    targetCashFlow, targetYear, horizonYears, includeNewProps,
    storageReady,
  ]);

  // The actual cloud save function — used by the timer AND the manual button
  const pushToCloud = async () => {
    if (!isFirebaseConfigured || !dirtyRef.current) return;
    dirtyRef.current = false;
    setSaveStatus(s => ({ ...s, dirty: false }));
    try {
      await cloudSaveBatch(buildSnapshot());
      lastSavedAtRef.current = Date.now();
      setSaveStatus(s => ({ ...s, lastSavedAt: Date.now(), dirty: false }));
    } catch (e) {
      console.error('Cloud save failed:', e);
      // Re-flag as dirty so we'll retry next interval
      dirtyRef.current = true;
      setSaveStatus(s => ({ ...s, dirty: true }));
    }
  };

  // Every 60 seconds, push to cloud if anything changed
  useEffect(() => {
    if (!isFirebaseConfigured || !storageReady) return;
    const interval = setInterval(pushToCloud, 60_000);
    return () => clearInterval(interval);
  }, [storageReady]);

  // Every second, update the "seconds until next save" countdown for the UI
  useEffect(() => {
    if (!isFirebaseConfigured) return;
    const interval = setInterval(() => {
      setSaveStatus(s => {
        if (!s.lastSavedAt && !s.dirty) return s;
        // Calculate seconds since the timer last fired
        const secondsSinceLastSave = s.lastSavedAt ? Math.floor((Date.now() - s.lastSavedAt) / 1000) : null;
        return { ...s, secondsSinceLastSave };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Safety net: push to cloud before the page unloads
  useEffect(() => {
    if (!isFirebaseConfigured) return;
    const handler = () => {
      if (dirtyRef.current) {
        // Synchronous-ish save attempt — may or may not complete, but worth trying
        cloudSaveBatch(buildSnapshot());
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  });

  // Run simulation
  const sim = useMemo(() => simulate(properties, {
    horizonYears, appreciation, rentGrowth, extraPrincipalMonthly, snowballTargetId,
    plannedAcquisitions: acquisitions, includeNewProps, cashFlowReinvestPct, lumpPayments,
  }), [properties, horizonYears, appreciation, rentGrowth, extraPrincipalMonthly, snowballTargetId, acquisitions, includeNewProps, cashFlowReinvestPct, lumpPayments]);

  // Find when goal is reached
  // Goal compares against POCKETED cash flow (what they actually live on in retirement),
  // not gross cash flow that's being reinvested into paydown.
  const goalReachedYear = sim.yearly.find(y => y.cashFlowPocketed >= targetCashFlow)?.year || null;
  const onTrack = goalReachedYear !== null && goalReachedYear <= targetYear;
  const ahead = goalReachedYear !== null && goalReachedYear < targetYear;
  const goalYearData = sim.yearly.find(y => y.year === targetYear);
  const cashFlowAtGoalYear = goalYearData?.cashFlowPocketed || 0;
  const gap = targetCashFlow - cashFlowAtGoalYear;

  // ─── Render ───
  return (
    <div className="min-h-screen" style={{
      background: '#F5EFE2',
      fontFamily: "'Lora', Georgia, serif",
      color: '#1A2E26',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700;9..144,900&family=Lora:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');
        .display { font-family: 'Fraunces', Georgia, serif; font-variation-settings: "opsz" 144, "SOFT" 50; }
        .mono { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
        .tab-btn { transition: all 200ms ease; }
        input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>

      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-12">

        {/* ─── Header ─── */}
        <header className="mb-8">
          <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
            <div className="text-xs uppercase tracking-[0.3em]" style={{ color: '#8B6F47' }}>
              Retirement gameplan · Personalized
            </div>
            <CloudStatusBadge status={cloudStatus} saveStatus={saveStatus} onSaveNow={pushToCloud} />
          </div>
          <h1 className="display text-4xl sm:text-6xl font-bold leading-[0.95] mb-4" style={{ color: '#0F1F1A' }}>
            Mom & Dad's<br />
            <em style={{ color: '#B5563D' }}>path to retirement</em>
          </h1>
          <p className="text-base sm:text-lg max-w-2xl leading-relaxed" style={{ color: '#3A4F44' }}>
            Six rentals, real numbers, and the levers to pull. Plug in goals, watch the math, and figure out exactly what it takes to retire on rental income.
          </p>
        </header>

        {/* ─── Headline status ─── */}
        <HeadlineStatus
          targetCashFlow={targetCashFlow}
          targetYear={targetYear}
          goalReachedYear={goalReachedYear}
          cashFlowAtGoalYear={cashFlowAtGoalYear}
          onTrack={onTrack}
          ahead={ahead}
          gap={gap}
        />

        {/* ─── Tab selector ─── */}
        <div className="mb-6 flex flex-wrap gap-2 sm:gap-3">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'properties', label: 'Property data' },
            { id: 'levers', label: 'Levers' },
            { id: 'lumps', label: `Lump payments${lumpPayments.length > 0 ? ` (${lumpPayments.length})` : ''}` },
            { id: 'acquisitions', label: `New acquisitions${acquisitions.length > 0 ? ` (${acquisitions.length})` : ''}` },
            { id: 'detail', label: 'Year-by-year' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className="tab-btn px-4 py-2 text-sm uppercase tracking-wider"
              style={{
                background: activeTab === t.id ? '#1A2E26' : '#FAF6EB',
                color: activeTab === t.id ? '#F5EFE2' : '#3A4F44',
                border: `1px solid ${activeTab === t.id ? '#1A2E26' : '#D4C7A8'}`,
                fontFamily: 'JetBrains Mono',
                fontWeight: 600,
                fontSize: 11,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ─── Tab contents ─── */}
        {activeTab === 'overview' && (
          <OverviewTab
            sim={sim}
            targetCashFlow={targetCashFlow}
            targetYear={targetYear}
            goalReachedYear={goalReachedYear}
            properties={properties}
          />
        )}

        {activeTab === 'properties' && (
          <PropertiesTab properties={properties} setProperties={setProperties} />
        )}

        {activeTab === 'levers' && (
          <LeversTab
            appreciation={appreciation} setAppreciation={setAppreciation}
            rentGrowth={rentGrowth} setRentGrowth={setRentGrowth}
            extraPrincipalMonthly={extraPrincipalMonthly} setExtraPrincipalMonthly={setExtraPrincipalMonthly}
            cashFlowReinvestPct={cashFlowReinvestPct} setCashFlowReinvestPct={setCashFlowReinvestPct}
            snowballTargetId={snowballTargetId} setSnowballTargetId={setSnowballTargetId}
            targetCashFlow={targetCashFlow} setTargetCashFlow={setTargetCashFlow}
            targetYear={targetYear} setTargetYear={setTargetYear}
            horizonYears={horizonYears} setHorizonYears={setHorizonYears}
            properties={properties}
            sim={sim}
          />
        )}

        {activeTab === 'lumps' && (
          <LumpPaymentsTab
            lumpPayments={lumpPayments} setLumpPayments={setLumpPayments}
            properties={properties} horizonYears={horizonYears}
            sim={sim}
          />
        )}

        {activeTab === 'acquisitions' && (
          <AcquisitionsTab
            acquisitions={acquisitions} setAcquisitions={setAcquisitions}
            includeNewProps={includeNewProps} setIncludeNewProps={setIncludeNewProps}
            horizonYears={horizonYears}
          />
        )}

        {activeTab === 'detail' && (
          <DetailTab sim={sim} />
        )}

        {/* ─── Footer ─── */}
        <footer className="pt-8 mt-12 text-sm leading-relaxed" style={{ borderTop: '1px solid #D4C7A8', color: '#5A6F64' }}>
          <p className="mb-2">
            <span className="display font-semibold" style={{ color: '#1A2E26' }}>How "cash flow" is calculated. </span>
            Monthly net rent (after 5% vacancy) − property tax − insurance − maintenance reserve − mortgage P&I = monthly cash flow. Not factored: income tax on rental income (typically offset substantially by depreciation), property management fees, capex events.
          </p>
          <p>
            <span className="display font-semibold" style={{ color: '#1A2E26' }}>Snowball method. </span>
            Extra principal is applied to ONE property at a time (smallest balance by default, or your choice). When that property is paid off, the extra amount + the freed-up mortgage payment automatically rolls to the next target. This is the "debt snowball" applied to rentals.
          </p>
        </footer>
      </div>
    </div>
  );
}

// ─────────────────────────── Headline status ───────────────────────────

// ─────────────────────────── Cloud status badge ───────────────────────────

function CloudStatusBadge({ status, saveStatus, onSaveNow }) {
  // Build label that incorporates save state when connected
  let bg, fg, label, tooltip;

  if (status === 'connecting') {
    bg = '#EFE7D2'; fg = '#8B6F47'; label = '○ Syncing…';
  } else if (status === 'error') {
    bg = '#F5D5C4'; fg = '#B5563D'; label = '⚠ Sync error — using local only';
  } else if (status === 'local-only') {
    bg = '#EFE7D2'; fg = '#8B6F47'; label = '○ Local only (this device)';
    tooltip = 'Set up Firebase to sync data across devices. See FIREBASE_SETUP.md.';
  } else if (status === 'connected') {
    if (saveStatus?.dirty) {
      bg = '#FFF4D6'; fg = '#8B6F47'; label = '◐ Unsaved changes — auto-saves every minute';
    } else if (saveStatus?.lastSavedAt) {
      const secs = saveStatus.secondsSinceLastSave ?? 0;
      let timeLabel;
      if (secs < 5) timeLabel = 'just now';
      else if (secs < 60) timeLabel = `${secs}s ago`;
      else if (secs < 3600) timeLabel = `${Math.floor(secs / 60)}m ago`;
      else timeLabel = `${Math.floor(secs / 3600)}h ago`;
      bg = '#D4E8DA'; fg = '#2D5043'; label = `● Saved ${timeLabel} · synced`;
    } else {
      bg = '#D4E8DA'; fg = '#2D5043'; label = '● Synced across devices';
    }
  }

  const showSaveNow = status === 'connected' && saveStatus?.dirty;

  return (
    <div className="flex items-center gap-2">
      <div
        className="mono text-xs px-2 py-1"
        style={{ background: bg, color: fg, borderRadius: 2, letterSpacing: 0.5 }}
        title={tooltip || ''}
      >
        {label}
      </div>
      {showSaveNow && (
        <button
          onClick={onSaveNow}
          className="mono text-xs px-2 py-1"
          style={{ background: '#2D5043', color: '#F5EFE2', borderRadius: 2, letterSpacing: 0.5, border: 'none', cursor: 'pointer' }}
        >
          Save now
        </button>
      )}
    </div>
  );
}

function HeadlineStatus({ targetCashFlow, targetYear, goalReachedYear, cashFlowAtGoalYear, onTrack, ahead, gap }) {
  let bg, accent, headline, sub;

  if (ahead) {
    bg = '#2D5043'; accent = '#A8D4BA';
    headline = `Ahead of plan — goal hit by year ${goalReachedYear}`;
    sub = `Target was year ${targetYear}. You'll be generating ${fmtMo(targetCashFlow)} ${targetYear - goalReachedYear} year${targetYear - goalReachedYear === 1 ? '' : 's'} early.`;
  } else if (onTrack) {
    bg = '#2D5043'; accent = '#A8D4BA';
    headline = `On track — goal hit by year ${goalReachedYear}`;
    sub = `Right on time. ${fmtMo(targetCashFlow)} cash flow achievable by year ${goalReachedYear}.`;
  } else if (goalReachedYear) {
    bg = '#B5563D'; accent = '#F5D5C4';
    headline = `Behind goal — ${fmtMo(cashFlowAtGoalYear)} at year ${targetYear}`;
    sub = `${fmtMo(targetCashFlow)} goal not reached until year ${goalReachedYear} (${goalReachedYear - targetYear} year${goalReachedYear - targetYear === 1 ? '' : 's'} late). Gap: ${fmtMo(Math.abs(gap))} short.`;
  } else {
    bg = '#1A2E26'; accent = '#D4C7A8';
    headline = `Goal not reached within horizon`;
    sub = `At year ${targetYear} you'll have ${fmtMo(cashFlowAtGoalYear)}. Gap: ${fmtMo(Math.abs(gap))}/mo. Try increasing extra principal, adjusting goals, or planning new acquisitions.`;
  }

  return (
    <section className="mb-8 p-6 sm:p-8" style={{ background: bg, color: accent, border: `2px solid ${bg}`, borderRadius: 2 }}>
      <div className="text-xs uppercase tracking-[0.3em] mb-2" style={{ opacity: 0.75 }}>Status</div>
      <h2 className="display text-2xl sm:text-4xl font-semibold mb-2" style={{ color: '#F5EFE2' }}>
        {headline}
      </h2>
      <p className="text-base sm:text-lg" style={{ opacity: 0.95 }}>
        {sub}
      </p>
    </section>
  );
}

// ─────────────────────────── Overview tab ───────────────────────────

function OverviewTab({ sim, targetCashFlow, targetYear, goalReachedYear, properties }) {
  const cashFlowChartData = sim.yearly.map(y => ({
    year: y.year,
    pocketed: Math.round(y.cashFlowPocketed),
    reinvested: Math.round(y.cashFlowReinvested),
    gross: Math.round(y.cashFlow),
  }));

  const debtChartData = sim.yearly.map(y => ({
    year: y.year,
    debt: Math.round(y.totalDebt),
    equity: Math.round(y.totalEquity),
  }));

  const goalYearSnapshot = sim.yearly.find(y => y.year === targetYear);
  const finalSnapshot = sim.yearly[sim.yearly.length - 1];

  return (
    <div>
      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Monthly cash flow — pocketed vs. reinvested" subtitle={`Goal compares against pocketed line. Target: ${fmtMo(targetCashFlow)} by year ${targetYear}`}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={cashFlowChartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
              <CartesianGrid stroke="#D4C7A8" strokeDasharray="2 4" />
              <XAxis dataKey="year" stroke="#3A4F44" tick={{ fontFamily: 'JetBrains Mono', fontSize: 11 }} />
              <YAxis stroke="#3A4F44" tick={{ fontFamily: 'JetBrains Mono', fontSize: 11 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: '#FAF6EB', border: '1.5px solid #1A2E26', fontFamily: 'JetBrains Mono', fontSize: 12 }}
                formatter={(v, name) => [fmtMo(v), name]}
                labelFormatter={(l) => `Year ${l}`}
              />
              <Legend wrapperStyle={{ fontFamily: 'Lora', fontSize: 13 }} />
              <ReferenceLine y={targetCashFlow} stroke="#B5563D" strokeDasharray="4 4" label={{ value: 'Goal', position: 'right', fill: '#B5563D', fontSize: 11, fontFamily: 'Lora' }} />
              {goalReachedYear && (
                <ReferenceLine x={goalReachedYear} stroke="#2D5043" strokeDasharray="4 4" label={{ value: `Yr ${goalReachedYear}`, position: 'top', fill: '#2D5043', fontSize: 11, fontFamily: 'Lora' }} />
              )}
              <Line type="monotone" dataKey="gross" name="Gross cash flow" stroke="#8B6F47" strokeWidth={1.5} strokeDasharray="3 3" dot={false} />
              <Line type="monotone" dataKey="pocketed" name="To pocket" stroke="#2D5043" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="reinvested" name="To paydown" stroke="#B5563D" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Total mortgage debt vs. equity" subtitle="Snowball paydown effect across all properties">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={debtChartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
              <CartesianGrid stroke="#D4C7A8" strokeDasharray="2 4" />
              <XAxis dataKey="year" stroke="#3A4F44" tick={{ fontFamily: 'JetBrains Mono', fontSize: 11 }} />
              <YAxis stroke="#3A4F44" tick={{ fontFamily: 'JetBrains Mono', fontSize: 11 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: '#FAF6EB', border: '1.5px solid #1A2E26', fontFamily: 'JetBrains Mono', fontSize: 12 }}
                formatter={(v) => fmt(v)}
                labelFormatter={(l) => `Year ${l}`}
              />
              <Legend wrapperStyle={{ fontFamily: 'Lora', fontSize: 13 }} />
              <Area type="monotone" dataKey="debt" name="Mortgage debt" fill="#B5563D" fillOpacity={0.3} stroke="#B5563D" strokeWidth={2} />
              <Area type="monotone" dataKey="equity" name="Total equity" fill="#2D5043" fillOpacity={0.3} stroke="#2D5043" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Snapshot cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <SnapshotCard title={`Year ${targetYear} — Target retirement`} snapshot={goalYearSnapshot} accent="#B5563D" targetCashFlow={targetCashFlow} />
        <SnapshotCard title={`Year ${finalSnapshot?.year || 20} — Long-term outlook`} snapshot={finalSnapshot} accent="#2D5043" targetCashFlow={targetCashFlow} />
      </div>

      {/* Property payoff roadmap */}
      <PayoffRoadmap sim={sim} properties={properties} />
    </div>
  );
}

function ChartCard({ title, subtitle, children }) {
  return (
    <div className="p-5 rounded-sm" style={{ background: '#FAF6EB', border: '1px solid #D4C7A8' }}>
      <div className="mb-3">
        <h3 className="display text-lg font-semibold" style={{ color: '#1A2E26' }}>{title}</h3>
        {subtitle && <div className="text-xs mono" style={{ color: '#8B6F47' }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function SnapshotCard({ title, snapshot, accent, targetCashFlow }) {
  if (!snapshot) return null;
  const status = snapshot.cashFlowPocketed >= targetCashFlow ? 'hit' : 'short';

  return (
    <div className="p-6 rounded-sm" style={{ background: '#FAF6EB', border: `2px solid ${accent}` }}>
      <div className="text-xs uppercase tracking-widest mb-2" style={{ color: '#8B6F47' }}>Snapshot</div>
      <h3 className="display text-xl font-semibold mb-4" style={{ color: accent }}>{title}</h3>

      <div className="space-y-2 mb-4">
        <Row label="Cash flow pocketed" value={fmtMo(snapshot.cashFlowPocketed)} highlight={status === 'hit'} accent={accent} />
        <Row label="Cash flow reinvested" value={fmtMo(snapshot.cashFlowReinvested)} />
        <Row label="  └ Gross monthly cash flow" value={fmtMo(snapshot.cashFlow)} />
        <Row label="Annual pocketed" value={fmt(snapshot.annualCashFlowPocketed)} />
        <Row label="Total properties" value={`${snapshot.propertiesOwned} owned · ${snapshot.propertiesPaidOff} paid off`} />
        <Row label="Portfolio value" value={fmt(snapshot.totalValue)} />
        <Row label="Total mortgage debt" value={fmt(snapshot.totalDebt)} />
        <Row label="Total equity" value={fmt(snapshot.totalEquity)} highlight accent={accent} />
      </div>

      <div className="pt-3 text-xs mono" style={{ borderTop: '1px dashed #D4C7A8', color: '#5A6F64' }}>
        Avg net rent: {fmt(snapshot.netRent)}/mo · Ops: {fmt(snapshot.netOps)}/mo · P&I: {fmt(snapshot.netPI)}/mo
      </div>
    </div>
  );
}

function Row({ label, value, highlight, accent = '#1A2E26' }) {
  return (
    <div className="flex justify-between items-baseline text-sm">
      <span style={{ color: '#3A4F44', fontWeight: highlight ? 600 : 400 }}>{label}</span>
      <span className="mono font-semibold" style={{ color: highlight ? accent : '#1A2E26', fontSize: highlight ? '1.05em' : '1em' }}>{value}</span>
    </div>
  );
}

function PayoffRoadmap({ sim, properties }) {
  // Determine payoff year for each property
  const finalState = sim.finalProperties || [];
  const roadmap = finalState.map(p => {
    const payoffYear = p.payoffMonth ? Math.ceil(p.payoffMonth / 12) : null;
    return { ...p, payoffYear };
  }).sort((a, b) => {
    if (a.payoffYear === null) return 1;
    if (b.payoffYear === null) return -1;
    return a.payoffYear - b.payoffYear;
  });

  return (
    <div className="p-6 rounded-sm mb-8" style={{ background: '#FAF6EB', border: '1px solid #D4C7A8' }}>
      <h3 className="display text-xl font-semibold mb-4" style={{ color: '#1A2E26' }}>Payoff roadmap</h3>
      <div className="space-y-2">
        {roadmap.map((p, i) => (
          <div key={p.id} className="flex items-baseline justify-between p-3 rounded-sm" style={{ background: p.payoffYear ? '#EFE7D2' : '#FAF6EB', border: '1px solid #D4C7A8' }}>
            <div>
              <span className="mono text-xs" style={{ color: '#8B6F47' }}>#{i + 1}</span>{' '}
              <span className="font-semibold" style={{ color: '#1A2E26' }}>{p.nickname}</span>
              {p.isNew && <span className="ml-2 text-xs px-2 py-0.5" style={{ background: '#2D5043', color: '#F5EFE2', borderRadius: 2 }}>NEW</span>}
            </div>
            <div className="mono text-sm" style={{ color: p.payoffYear ? '#2D5043' : '#B5563D', fontWeight: 600 }}>
              {p.payoffYear ? `Paid off year ${p.payoffYear}` : `Still ${fmt(p.balance)} owed`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────── Properties tab ───────────────────────────

function PropertiesTab({ properties, setProperties }) {
  const [expandedId, setExpandedId] = useState(null);

  const updateProp = (id, field, value) => {
    setProperties(properties.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const resetToSeed = () => {
    if (window.confirm('Reset all 6 properties to default seed data? Your current entries will be lost.')) {
      setProperties(SEED_PROPERTIES);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="display text-2xl font-semibold mb-1">The 6 properties</h2>
          <p className="text-sm" style={{ color: '#5A6F64' }}>Tap a property to edit. Changes save automatically.</p>
        </div>
        <button onClick={resetToSeed} className="px-3 py-1.5 text-xs uppercase tracking-wider mono" style={{ background: '#FAF6EB', border: '1px solid #B5563D', color: '#B5563D' }}>
          Reset to defaults
        </button>
      </div>

      <div className="space-y-3">
        {properties.map(p => (
          <PropertyCard
            key={p.id}
            property={p}
            isExpanded={expandedId === p.id}
            onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
            onUpdate={(field, value) => updateProp(p.id, field, value)}
          />
        ))}
      </div>
    </div>
  );
}

function PropertyCard({ property: p, isExpanded, onToggle, onUpdate }) {
  const monthlyPIVal = monthlyPI(p.balance, p.rate, p.yearsLeft);
  const monthlyOps = (p.value * (p.taxRate + p.insRate + p.maintRate) / 100) / 12;
  const monthlyVacancy = p.monthlyRent * (p.vacancy / 100);
  const monthlyCashFlow = p.monthlyRent - monthlyVacancy - monthlyOps - monthlyPIVal;
  const equity = p.value - p.balance;
  const ltv = p.value > 0 ? (p.balance / p.value) * 100 : 0;

  return (
    <div className="rounded-sm overflow-hidden" style={{ background: '#FAF6EB', border: '1px solid #D4C7A8' }}>
      <div onClick={onToggle} className="p-4 cursor-pointer flex items-center justify-between" style={{ background: isExpanded ? '#EFE7D2' : 'transparent' }}>
        <div className="flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="display text-lg font-semibold" style={{ color: '#1A2E26' }}>{p.nickname}</span>
            {p.balance === 0 && <span className="text-xs px-2 py-0.5" style={{ background: '#2D5043', color: '#F5EFE2', borderRadius: 2 }}>PAID OFF</span>}
          </div>
          <div className="text-xs mono mt-1" style={{ color: '#5A6F64' }}>
            Value {fmtK(p.value)} · Balance {fmtK(p.balance)} · Rent ${p.monthlyRent.toLocaleString()}/mo · CF {fmtMo(monthlyCashFlow)}
          </div>
        </div>
        <div className="text-2xl mono" style={{ color: '#8B6F47', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 200ms' }}>›</div>
      </div>

      {isExpanded && (
        <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-4" style={{ borderTop: '1px solid #D4C7A8' }}>
          <Field label="Nickname" value={p.nickname} type="text" onChange={(v) => onUpdate('nickname', v)} />
          <Field label="Current value" value={p.value} type="number" prefix="$" onChange={(v) => onUpdate('value', Number(v))} />
          <Field label="Mortgage balance" value={p.balance} type="number" prefix="$" onChange={(v) => onUpdate('balance', Number(v))} />
          <Field label="Interest rate" value={p.rate} type="number" suffix="%" step="0.01" onChange={(v) => onUpdate('rate', Number(v))} />
          <Field label="Years left on loan" value={p.yearsLeft} type="number" onChange={(v) => onUpdate('yearsLeft', Number(v))} />
          <Field label="Monthly rent" value={p.monthlyRent} type="number" prefix="$" onChange={(v) => onUpdate('monthlyRent', Number(v))} />
          <Field label="Property tax rate" value={p.taxRate} type="number" suffix="%/yr" step="0.1" onChange={(v) => onUpdate('taxRate', Number(v))} />
          <Field label="Insurance rate" value={p.insRate} type="number" suffix="%/yr" step="0.1" onChange={(v) => onUpdate('insRate', Number(v))} />
          <Field label="Maintenance" value={p.maintRate} type="number" suffix="%/yr" step="0.1" onChange={(v) => onUpdate('maintRate', Number(v))} />
          <Field label="Vacancy" value={p.vacancy} type="number" suffix="%" step="1" onChange={(v) => onUpdate('vacancy', Number(v))} />

          <div className="col-span-2 sm:col-span-3 mt-2 pt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mono" style={{ borderTop: '1px dashed #D4C7A8' }}>
            <Stat label="Equity" value={fmt(equity)} />
            <Stat label="LTV" value={`${ltv.toFixed(1)}%`} />
            <Stat label="P&I/mo" value={fmt(monthlyPIVal)} />
            <Stat label="Cash flow/mo" value={fmt(monthlyCashFlow)} accent={monthlyCashFlow >= 0 ? '#2D5043' : '#B5563D'} />
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, type, prefix, suffix, step, onChange }) {
  // Local state so typing doesn't get clobbered by parent re-renders.
  // We only commit the value upward when the user blurs the field or presses Enter.
  const [localValue, setLocalValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);

  // If parent value changes (e.g. cloud sync from another device) and we're not focused, update display.
  useEffect(() => {
    if (!isFocused) setLocalValue(value);
  }, [value, isFocused]);

  const commit = () => {
    if (localValue !== value) onChange(localValue);
    setIsFocused(false);
  };

  return (
    <div>
      <label className="text-xs uppercase tracking-wider block mb-1" style={{ color: '#5A6F64' }}>{label}</label>
      <div className="flex items-center" style={{ background: '#FFFFFF', border: '1px solid #D4C7A8' }}>
        {prefix && <span className="px-2 mono text-sm" style={{ color: '#8B6F47' }}>{prefix}</span>}
        <input
          type={type}
          value={localValue}
          step={step}
          onChange={(e) => setLocalValue(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
          className="flex-1 px-2 py-2 mono text-sm bg-transparent outline-none"
          style={{ color: '#1A2E26', minWidth: 0, width: '100%' }}
        />
        {suffix && <span className="px-2 mono text-xs" style={{ color: '#8B6F47' }}>{suffix}</span>}
      </div>
    </div>
  );
}

function Stat({ label, value, accent = '#1A2E26' }) {
  return (
    <div>
      <div className="text-xs uppercase" style={{ color: '#8B6F47' }}>{label}</div>
      <div className="font-semibold" style={{ color: accent }}>{value}</div>
    </div>
  );
}

// ─────────────────────────── Levers tab ───────────────────────────

function LeversTab({ appreciation, setAppreciation, rentGrowth, setRentGrowth,
  extraPrincipalMonthly, setExtraPrincipalMonthly, cashFlowReinvestPct, setCashFlowReinvestPct,
  snowballTargetId, setSnowballTargetId,
  targetCashFlow, setTargetCashFlow, targetYear, setTargetYear, horizonYears, setHorizonYears,
  properties, sim }) {

  const eligibleTargets = properties.filter(p => p.balance > 0);

  // Show current-year split for context
  const currentYear = sim?.yearly?.[0];
  const grossNow = currentYear?.cashFlow || 0;
  const pocketNow = currentYear?.cashFlowPocketed || 0;
  const reinvestNow = currentYear?.cashFlowReinvested || 0;

  return (
    <div className="space-y-6">

      <Section title="The goals" accent="#B5563D" subtitle="What does retirement look like for you?">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <Slider
            label="Target monthly cash flow"
            value={targetCashFlow}
            setValue={setTargetCashFlow}
            min={3000} max={30000} step={500}
            prefix="$" suffix="/mo"
          />
          <Slider
            label="Target year (from now)"
            value={targetYear}
            setValue={setTargetYear}
            min={1} max={20} step={1}
            suffix=" years"
          />
          <Slider
            label="Planning horizon"
            value={horizonYears}
            setValue={setHorizonYears}
            min={5} max={30} step={1}
            suffix=" years"
          />
        </div>
      </Section>

      <Section title="The extra principal lever" accent="#2D5043" subtitle="Snowball method — extra cash thrown at ONE property at a time, then rolled to the next when paid off.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
          <Slider
            label="Extra principal per month (from outside income)"
            value={extraPrincipalMonthly}
            setValue={setExtraPrincipalMonthly}
            min={0} max={5000} step={100}
            prefix="$" suffix="/mo"
            subtext="Applied to the active snowball target. Auto-rolls when target is paid off."
          />
          <div>
            <div className="text-xs uppercase tracking-wider mb-2" style={{ color: '#5A6F64' }}>First snowball target</div>
            <select
              value={snowballTargetId}
              onChange={(e) => setSnowballTargetId(Number(e.target.value))}
              className="w-full px-3 py-3 mono text-sm"
              style={{ background: '#FFFFFF', border: '1px solid #D4C7A8', color: '#1A2E26' }}
            >
              {eligibleTargets.map(p => (
                <option key={p.id} value={p.id}>
                  {p.nickname} — {fmtK(p.balance)} balance @ {p.rate}%
                </option>
              ))}
            </select>
            <div className="text-xs mt-2 mono" style={{ color: '#8B6F47' }}>
              Tip: paying off the smallest balance first frees up cash flow fastest. Paying off the highest interest rate saves the most money long-term.
            </div>
          </div>
        </div>
      </Section>

      <Section title="Pocket vs. reinvest" accent="#B5563D" subtitle="What % of monthly cash flow do you pocket for retirement spending vs. throw back at the snowball to accelerate paydown?">
        <div className="mb-5">
          <Slider
            label={`Reinvest ${cashFlowReinvestPct}% into snowball, pocket ${100 - cashFlowReinvestPct}%`}
            value={cashFlowReinvestPct}
            setValue={setCashFlowReinvestPct}
            min={0} max={100} step={5}
            suffix="% reinvested"
            subtext="Slide right to accelerate debt payoff (less to live on now). Slide left to start enjoying the income (slower payoff, longer to retirement)."
          />
        </div>

        {/* Live split visualization for current month */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-sm" style={{ background: '#EFE7D2', border: '1px dashed #D4C7A8' }}>
          <div>
            <div className="text-xs uppercase tracking-wider mb-1" style={{ color: '#8B6F47' }}>Year 1 gross cash flow</div>
            <div className="mono text-lg font-semibold" style={{ color: '#1A2E26' }}>{fmtMo(grossNow)}</div>
            <div className="text-xs" style={{ color: '#5A6F64' }}>Total rent − ops − P&I</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider mb-1" style={{ color: '#8B6F47' }}>→ to pocket (live on)</div>
            <div className="mono text-lg font-semibold" style={{ color: '#2D5043' }}>{fmtMo(pocketNow)}</div>
            <div className="text-xs" style={{ color: '#5A6F64' }}>{grossNow > 0 ? `${Math.round((pocketNow / grossNow) * 100)}% of gross` : '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider mb-1" style={{ color: '#8B6F47' }}>→ to debt paydown</div>
            <div className="mono text-lg font-semibold" style={{ color: '#B5563D' }}>{fmtMo(reinvestNow)}</div>
            <div className="text-xs" style={{ color: '#5A6F64' }}>+ {fmtMo(extraPrincipalMonthly)} from outside</div>
          </div>
        </div>

        <div className="mt-4 text-sm" style={{ color: '#5A6F64' }}>
          <span className="display font-semibold" style={{ color: '#1A2E26' }}>The trade-off: </span>
          The status banner at the top measures your <em>pocketed</em> cash flow against the goal — that's what funds retirement. Reinvesting more accelerates the snowball (so cash flow grows faster long-term), but delays the day you start drawing meaningful income.
        </div>
      </Section>

      <Section title="Market assumptions" accent="#5A6F64" subtitle="Macro factors that affect both rents and equity over time.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <Slider label="Real estate appreciation" value={appreciation} setValue={setAppreciation} min={0} max={8} step={0.5} suffix="%/yr" />
          <Slider label="Rent growth" value={rentGrowth} setValue={setRentGrowth} min={0} max={8} step={0.5} suffix="%/yr" />
        </div>
      </Section>

    </div>
  );
}

function Section({ title, subtitle, accent, children }) {
  return (
    <div className="p-6 rounded-sm" style={{ background: '#FAF6EB', border: `1px solid #D4C7A8`, borderLeft: `4px solid ${accent}` }}>
      <div className="mb-4">
        <h3 className="display text-xl font-semibold" style={{ color: accent }}>{title}</h3>
        {subtitle && <p className="text-sm" style={{ color: '#5A6F64' }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Slider({ label, value, setValue, min, max, step, prefix = '', suffix = '', subtext = null }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider mb-1" style={{ color: '#5A6F64' }}>{label}</div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="mono text-xl sm:text-2xl font-semibold" style={{ color: '#1A2E26' }}>
          {prefix}{value.toLocaleString()}{suffix}
        </span>
      </div>
      {subtext && <div className="text-xs mb-2" style={{ color: '#8B6F47' }}>{subtext}</div>}
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => setValue(parseFloat(e.target.value))}
        className="w-full"
        style={{ accentColor: '#2D5043' }}
      />
    </div>
  );
}

// ─────────────────────────── Acquisitions tab ───────────────────────────

function AcquisitionsTab({ acquisitions, setAcquisitions, includeNewProps, setIncludeNewProps, horizonYears }) {
  const addAcquisition = () => {
    const newAcq = {
      id: Date.now(),
      nickname: `New Property ${acquisitions.length + 1}`,
      acquireMonth: 12,
      purchasePrice: 280000,
      downPayment: 70000,
      loanAmount: 210000,
      rate: 7.0,
      termYears: 30,
      monthlyRent: 2200,
    };
    setAcquisitions([...acquisitions, newAcq]);
  };

  const removeAcq = (id) => setAcquisitions(acquisitions.filter(a => a.id !== id));

  const updateAcq = (id, field, value) => {
    setAcquisitions(acquisitions.map(a => {
      if (a.id !== id) return a;
      const updated = { ...a, [field]: value };
      // Auto-calc loanAmount when price/down change
      if (field === 'purchasePrice' || field === 'downPayment') {
        updated.loanAmount = Math.max(0, updated.purchasePrice - updated.downPayment);
      }
      return updated;
    }));
  };

  return (
    <div>
      <div className="mb-6 p-5 rounded-sm" style={{ background: '#FAF6EB', border: '1px solid #D4C7A8' }}>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={includeNewProps}
            onChange={(e) => setIncludeNewProps(e.target.checked)}
            className="w-5 h-5"
            style={{ accentColor: '#2D5043' }}
          />
          <span className="display text-lg font-semibold" style={{ color: '#1A2E26' }}>
            Include planned acquisitions in simulation
          </span>
        </label>
        <p className="text-sm mt-1 ml-8" style={{ color: '#5A6F64' }}>
          Toggle off to see "what if we don't buy anything new" — useful for understanding the baseline trajectory.
        </p>
      </div>

      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <h2 className="display text-2xl font-semibold">Future acquisitions</h2>
        <button onClick={addAcquisition} className="px-4 py-2 text-sm uppercase tracking-wider mono" style={{ background: '#2D5043', color: '#F5EFE2' }}>
          + Add property
        </button>
      </div>

      {acquisitions.length === 0 ? (
        <div className="p-8 text-center rounded-sm" style={{ background: '#FAF6EB', border: '1px dashed #D4C7A8' }}>
          <p style={{ color: '#5A6F64' }}>No acquisitions planned yet. Click "Add property" to model buying additional rentals.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {acquisitions.map(a => (
            <AcquisitionCard
              key={a.id}
              acq={a}
              horizonYears={horizonYears}
              onUpdate={(f, v) => updateAcq(a.id, f, v)}
              onRemove={() => removeAcq(a.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AcquisitionCard({ acq: a, horizonYears, onUpdate, onRemove }) {
  const monthlyPIVal = monthlyPI(a.loanAmount, a.rate, a.termYears);
  const acquireYear = Math.ceil(a.acquireMonth / 12);
  const acquireMonthInYear = ((a.acquireMonth - 1) % 12) + 1;

  return (
    <div className="rounded-sm" style={{ background: '#FAF6EB', border: '2px solid #2D5043' }}>
      <div className="p-4 flex items-baseline justify-between" style={{ background: '#EFE7D2', borderBottom: '1px solid #D4C7A8' }}>
        <div>
          <span className="display text-lg font-semibold" style={{ color: '#2D5043' }}>{a.nickname}</span>
          <span className="ml-3 text-xs mono" style={{ color: '#8B6F47' }}>Acquired in year {acquireYear}, month {acquireMonthInYear}</span>
        </div>
        <button onClick={onRemove} className="text-xs uppercase tracking-wider px-2 py-1 mono" style={{ color: '#B5563D', border: '1px solid #B5563D' }}>
          Remove
        </button>
      </div>

      <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Field label="Nickname" value={a.nickname} type="text" onChange={(v) => onUpdate('nickname', v)} />
        <div className="col-span-2 sm:col-span-1">
          <label className="text-xs uppercase tracking-wider block mb-1" style={{ color: '#5A6F64' }}>Acquire at month (1 = next month)</label>
          <input
            type="range"
            min={1} max={horizonYears * 12} step={1}
            value={a.acquireMonth}
            onChange={(e) => onUpdate('acquireMonth', Number(e.target.value))}
            className="w-full"
            style={{ accentColor: '#2D5043' }}
          />
          <div className="mono text-sm mt-1" style={{ color: '#1A2E26' }}>
            Year {acquireYear}, month {acquireMonthInYear} (= month {a.acquireMonth} of simulation)
          </div>
        </div>
        <div className="hidden sm:block" />
        <Field label="Purchase price" value={a.purchasePrice} type="number" prefix="$" onChange={(v) => onUpdate('purchasePrice', Number(v))} />
        <Field label="Down payment" value={a.downPayment} type="number" prefix="$" onChange={(v) => onUpdate('downPayment', Number(v))} />
        <Field label="Loan amount (auto)" value={a.loanAmount} type="number" prefix="$" onChange={(v) => onUpdate('loanAmount', Number(v))} />
        <Field label="Interest rate" value={a.rate} type="number" suffix="%" step="0.01" onChange={(v) => onUpdate('rate', Number(v))} />
        <Field label="Loan term" value={a.termYears} type="number" suffix=" yrs" onChange={(v) => onUpdate('termYears', Number(v))} />
        <Field label="Expected monthly rent" value={a.monthlyRent} type="number" prefix="$" onChange={(v) => onUpdate('monthlyRent', Number(v))} />

        <div className="col-span-2 sm:col-span-3 mt-2 pt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mono" style={{ borderTop: '1px dashed #D4C7A8' }}>
          <Stat label="Down %" value={a.purchasePrice > 0 ? `${((a.downPayment / a.purchasePrice) * 100).toFixed(0)}%` : '0%'} />
          <Stat label="P&I/mo" value={fmt(monthlyPIVal)} />
          <Stat label="Rent/PI ratio" value={monthlyPIVal > 0 ? `${((a.monthlyRent / monthlyPIVal) * 100).toFixed(0)}%` : '—'} />
          <Stat label="Cash needed" value={fmt(a.downPayment + a.purchasePrice * 0.03)} accent="#B5563D" />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Lump payments tab ───────────────────────────

function LumpPaymentsTab({ lumpPayments, setLumpPayments, properties, horizonYears, sim }) {
  const addLump = () => {
    const newLump = {
      id: Date.now(),
      label: 'New lump payment',
      month: 12,
      amount: 10000,
      targetPropertyId: null, // null = use active snowball target
    };
    setLumpPayments([...lumpPayments, newLump]);
  };

  const removeLump = (id) => setLumpPayments(lumpPayments.filter(l => l.id !== id));

  const updateLump = (id, field, value) => {
    setLumpPayments(lumpPayments.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  // Sort lumps by month for display
  const sortedLumps = [...lumpPayments].sort((a, b) => a.month - b.month);

  // Total being injected
  const totalInjected = lumpPayments.reduce((s, l) => s + (l.amount || 0), 0);

  return (
    <div>
      <div className="mb-6 p-5 rounded-sm" style={{ background: '#FAF6EB', border: '1px solid #D4C7A8' }}>
        <h2 className="display text-2xl font-semibold mb-2" style={{ color: '#1A2E26' }}>
          One-time lump payments
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: '#3A4F44' }}>
          Plan one-time cash injections toward debt paydown — selling a car, a tax refund, a bonus,
          an inheritance, money from a CD that matured, etc. Each payment lands on either the active
          snowball target (recommended) or a property you specifically choose.
        </p>
        {totalInjected > 0 && (
          <div className="mt-3 mono text-sm" style={{ color: '#2D5043', fontWeight: 600 }}>
            Total planned injections: {fmt(totalInjected)} across {lumpPayments.length} payment{lumpPayments.length === 1 ? '' : 's'}
          </div>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <h3 className="display text-xl font-semibold">Scheduled payments</h3>
        <button onClick={addLump} className="px-4 py-2 text-sm uppercase tracking-wider mono" style={{ background: '#B5563D', color: '#F5EFE2' }}>
          + Add lump payment
        </button>
      </div>

      {sortedLumps.length === 0 ? (
        <div className="p-8 text-center rounded-sm" style={{ background: '#FAF6EB', border: '1px dashed #D4C7A8' }}>
          <p style={{ color: '#5A6F64' }}>
            No lump payments scheduled yet. Click "Add lump payment" to plan one-time cash injections toward debt paydown.
          </p>
          <div className="mt-3 text-xs mono" style={{ color: '#8B6F47' }}>
            Examples: sell a car ($25k), tax refund ($8k), year-end bonus ($15k), inheritance ($50k)
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedLumps.map(l => (
            <LumpPaymentCard
              key={l.id}
              lump={l}
              properties={properties}
              horizonYears={horizonYears}
              onUpdate={(f, v) => updateLump(l.id, f, v)}
              onRemove={() => removeLump(l.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LumpPaymentCard({ lump: l, properties, horizonYears, onUpdate, onRemove }) {
  const acquireYear = Math.ceil(l.month / 12);
  const acquireMonthInYear = ((l.month - 1) % 12) + 1;
  const eligibleTargets = properties.filter(p => p.balance > 0);

  return (
    <div className="rounded-sm" style={{ background: '#FAF6EB', border: '2px solid #B5563D' }}>
      <div className="p-4 flex items-baseline justify-between flex-wrap gap-2" style={{ background: '#F5D5C4', borderBottom: '1px solid #D4C7A8' }}>
        <div>
          <span className="display text-lg font-semibold" style={{ color: '#B5563D' }}>{l.label}</span>
          <span className="ml-3 text-xs mono" style={{ color: '#8B6F47' }}>
            {fmt(l.amount)} in year {acquireYear}, month {acquireMonthInYear}
          </span>
        </div>
        <button onClick={onRemove} className="text-xs uppercase tracking-wider px-2 py-1 mono" style={{ color: '#B5563D', border: '1px solid #B5563D', background: '#FAF6EB' }}>
          Remove
        </button>
      </div>

      <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Field label="Label / source" value={l.label} type="text" onChange={(v) => onUpdate('label', v)} />
        <Field label="Amount" value={l.amount} type="number" prefix="$" onChange={(v) => onUpdate('amount', Number(v))} />
        <div>
          <label className="text-xs uppercase tracking-wider block mb-1" style={{ color: '#5A6F64' }}>Apply to</label>
          <select
            value={l.targetPropertyId || ''}
            onChange={(e) => onUpdate('targetPropertyId', e.target.value ? Number(e.target.value) : null)}
            className="w-full px-2 py-2 mono text-sm"
            style={{ background: '#FFFFFF', border: '1px solid #D4C7A8', color: '#1A2E26' }}
          >
            <option value="">Active snowball target (recommended)</option>
            {eligibleTargets.map(p => (
              <option key={p.id} value={p.id}>
                {p.nickname} ({fmtK(p.balance)} balance)
              </option>
            ))}
          </select>
        </div>

        <div className="col-span-2 sm:col-span-3">
          <label className="text-xs uppercase tracking-wider block mb-1" style={{ color: '#5A6F64' }}>
            When (drag to set timing)
          </label>
          <input
            type="range"
            min={1} max={horizonYears * 12} step={1}
            value={l.month}
            onChange={(e) => onUpdate('month', Number(e.target.value))}
            className="w-full"
            style={{ accentColor: '#B5563D' }}
          />
          <div className="mono text-sm mt-1" style={{ color: '#1A2E26' }}>
            Year {acquireYear}, month {acquireMonthInYear} (= month {l.month} of simulation)
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Detail tab ───────────────────────────

function DetailTab({ sim }) {
  return (
    <div className="rounded-sm overflow-hidden" style={{ background: '#FAF6EB', border: '1px solid #D4C7A8' }}>
      <div className="p-4 display text-lg font-semibold" style={{ background: '#1A2E26', color: '#F5EFE2' }}>
        Year-by-year detail
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm mono">
          <thead>
            <tr style={{ background: '#EFE7D2', color: '#5A6F64' }}>
              <th className="px-3 py-2 text-left">Year</th>
              <th className="px-3 py-2 text-right">Props</th>
              <th className="px-3 py-2 text-right">Paid off</th>
              <th className="px-3 py-2 text-right">Total value</th>
              <th className="px-3 py-2 text-right">Total debt</th>
              <th className="px-3 py-2 text-right">Equity</th>
              <th className="px-3 py-2 text-right" style={{ color: '#8B6F47' }}>Gross/mo</th>
              <th className="px-3 py-2 text-right" style={{ color: '#2D5043' }}>Pocket/mo</th>
              <th className="px-3 py-2 text-right" style={{ color: '#B5563D' }}>Paydown/mo</th>
              <th className="px-3 py-2 text-right">Annual pocket</th>
            </tr>
          </thead>
          <tbody>
            {sim.yearly.map((y, i) => (
              <tr key={i} style={{ borderTop: '1px solid #EFE7D2' }}>
                <td className="px-3 py-2 font-semibold" style={{ color: '#1A2E26' }}>{y.year}</td>
                <td className="px-3 py-2 text-right">{y.propertiesOwned}</td>
                <td className="px-3 py-2 text-right" style={{ color: y.propertiesPaidOff > 0 ? '#2D5043' : '#5A6F64' }}>
                  {y.propertiesPaidOff > 0 ? `${y.propertiesPaidOff} ✓` : '—'}
                </td>
                <td className="px-3 py-2 text-right">{fmtK(y.totalValue)}</td>
                <td className="px-3 py-2 text-right" style={{ color: '#B5563D' }}>{fmtK(y.totalDebt)}</td>
                <td className="px-3 py-2 text-right" style={{ color: '#2D5043', fontWeight: 600 }}>{fmtK(y.totalEquity)}</td>
                <td className="px-3 py-2 text-right" style={{ color: '#8B6F47' }}>{fmt(y.cashFlow)}</td>
                <td className="px-3 py-2 text-right" style={{ fontWeight: 600, color: '#2D5043' }}>{fmt(y.cashFlowPocketed)}</td>
                <td className="px-3 py-2 text-right" style={{ color: '#B5563D' }}>{fmt(y.cashFlowReinvested)}</td>
                <td className="px-3 py-2 text-right">{fmtK(y.annualCashFlowPocketed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
