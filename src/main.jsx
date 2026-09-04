import React, { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import {
  ShieldCheck, AlertTriangle, ArrowRight, RefreshCw, CheckCircle2, XCircle,
  Clock, DollarSign, Activity, FileText, BarChart3, Layers, User, ChevronRight,
  Filter, Search, AlertOctagon, HelpCircle, Lock, Cpu, Play, Menu, X
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  Cell, PieChart, Pie
} from 'recharts';
import './styles.css';

const formatINR = (paise) => {
  const rupees = (Number(paise) || 0) / 100;

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(rupees);
};

const formatPercent = (val) =>
  `${(Number(val) || 0).toFixed(1)}%`;

/*
 * Backend uses:
 * transactionId
 * amountRupees
 * paymentStatus
 * failureReason
 * customerName
 * customerEmail
 * recoveryStatus
 *
 * The existing UI uses:
 * id
 * amount (paise)
 * status
 * errorCode
 * customer
 *
 * This adapter keeps the backend and frontend contracts consistent.
 */
const normalizeTransaction = (t) => {
  const attempts = Array.isArray(t.recoveryAttempts)
    ? t.recoveryAttempts
    : [];

  const lastAttempt = attempts[attempts.length - 1];

  const isRecovered =
    t.paymentStatus === 'success' ||
    t.recoveryStatus === 'RECOVERED';

  const isEscalated =
    t.recoveryStatus === 'ESCALATED';

  return {
    id: t.transactionId,

    // UI formatter expects paise.
    amount: Math.round(Number(t.amountRupees || 0) * 100),

    errorCode: String(
      t.failureReason || 'UNKNOWN'
    ).toUpperCase(),

    errorDescription: t.failureReason
      ? `Payment failed because of ${String(
          t.failureReason
        ).replaceAll('_', ' ')}.`
      : 'Payment failure reason unavailable.',

    status: isRecovered
      ? 'RECOVERED'
      : isEscalated
        ? 'ESCALATED'
        : 'FAILED',

    attemptCount: attempts.length,

    customer: {
      name: t.customerName || 'Anonymous',
      email: t.customerEmail || ''
    },

    createdAt: t.createdAt,

    aiDiagnosis: t.riskLevel
      ? {
          riskLevel: t.riskLevel,
          confidence: Number(t.aiConfidence || 0),
          revenueAtRisk:
            Number(
              t.revenueAtRisk ||
              t.amountRupees ||
              0
            ) * 100,
          recommendedAction:
            t.recommendedAction || 'NO_ACTION',
          recommendedDelayMinutes: 0,
          messageType: 'NONE',
          reasoningSummary:
            t.diagnosis ||
            'AI diagnosis is available from the recovery pipeline.',
          expectedOutcome:
            'Recovery workflow evaluated'
        }
      : null,

    policyDecision: t.policyDecision
      ? {
          allowed:
            t.policyDecision.approved === true ||
            t.policyDecision.decision === 'APPROVED' ||
            t.policyDecision.decision === 'ESCALATED',

          reason:
            t.policyDecision.reason ||
            'Policy decision recorded.',

          code:
            t.policyDecision.ruleId ||
            'POLICY'
        }
      : null,

    recoveryResult: lastAttempt
      ? {
          actionTaken:
            lastAttempt.action || 'RECOVERY_ATTEMPTED',

          recovered:
            lastAttempt.status === 'RECOVERED',

          paymentLink:
            lastAttempt.paymentLink || null
        }
      : null,

    // Keep original backend object available.
    _raw: t
  };
};

const RiskBadge = ({ level }) => {
  const styles = {
    LOW: 'bg-emerald-950/60 text-emerald-400 border-emerald-800/80',
    MEDIUM: 'bg-amber-950/60 text-amber-400 border-amber-800/80',
    HIGH: 'bg-orange-950/60 text-orange-400 border-orange-800/80',
    CRITICAL: 'bg-rose-950/60 text-rose-400 border-rose-800/80'
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-full border whitespace-nowrap ${
        styles[level] ||
        'bg-slate-800 text-slate-300 border-slate-700'
      }`}
    >
      {level || 'UNKNOWN'}
    </span>
  );
};

const StatusBadge = ({ status }) => {
  const styles = {
    RECOVERED:
      'bg-emerald-900/40 text-emerald-300 border-emerald-700/60',

    FAILED:
      'bg-rose-900/40 text-rose-300 border-rose-700/60',

    ESCALATED:
      'bg-orange-900/40 text-orange-300 border-orange-700/60',

    TERMINAL_BLOCKED:
      'bg-red-950 text-red-400 border-red-800',

    PENDING:
      'bg-slate-800 text-slate-400 border-slate-700',

    PROCESSING:
      'bg-indigo-900/40 text-indigo-300 border-indigo-700/60 animate-pulse'
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-mono rounded border whitespace-nowrap ${
        styles[status] ||
        'bg-slate-800 text-slate-300 border-slate-700'
      }`}
    >
      {status}
    </span>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState('transactions');

  const [transactions, setTransactions] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [selectedTxn, setSelectedTxn] = useState(null);

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [filterRisk, setFilterRisk] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const [evalBatchSize, setEvalBatchSize] = useState(50);
  const [evalSeed, setEvalSeed] = useState('razorpay-seed-eval');
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalMetrics, setEvalMetrics] = useState(null);

  /*
   * Fetch real backend data.
   */
  const fetchData = async () => {
    try {
      setLoading(true);

      const [txnRes, auditRes] = await Promise.all([
        fetch('/api/transactions').catch(() => null),
        fetch('/api/audit-logs').catch(() => null)
      ]);

      if (txnRes && txnRes.ok) {
        const data = await txnRes.json();

        const normalized = Array.isArray(data)
          ? data.map(normalizeTransaction)
          : [];

        setTransactions(normalized);

        if (normalized.length > 0) {
          setSelectedTxn((current) => {
            if (!current) return normalized[0];

            return (
              normalized.find(
                (t) => t.id === current.id
              ) || normalized[0]
            );
          });
        }
      } else {
        seedLocalDemoState();
      }

      if (auditRes && auditRes.ok) {
        const aData = await auditRes.json();

        setAuditLogs(
          Array.isArray(aData) ? aData : []
        );
      }
    } catch (e) {
      console.error('Unable to fetch backend data:', e);
      seedLocalDemoState();
    } finally {
      setLoading(false);
    }
  };

  /*
   * Only used if backend is unavailable.
   * This is not the primary data source.
   */
  const seedLocalDemoState = () => {
    const mock = [
      {
        id: 'txn_demo_9901',
        amount: 850000,
        errorCode: 'GATEWAY_TIMEOUT',
        errorDescription:
          'Bank issuer response timed out after 30000ms',
        status: 'FAILED',
        attemptCount: 1,
        customer: {
          name: 'Demo Customer',
          email: 'demo@recoverai.local'
        },
        createdAt: new Date(
          Date.now() - 3600000
        ).toISOString(),

        aiDiagnosis: {
          riskLevel: 'MEDIUM',
          confidence: 0.89,
          revenueAtRisk: 850000,
          recommendedAction: 'RETRY_PAYMENT',
          recommendedDelayMinutes: 30,
          messageType: 'PAYMENT_RETRY',
          reasoningSummary:
            'Transient downstream issuer latency detected.',
          expectedOutcome:
            'Payment may succeed on a subsequent attempt.'
        },

        policyDecision: {
          allowed: true,
          reason: 'Eligible for bounded recovery.',
          code: 'DEFAULT_ALLOW'
        },

        recoveryResult: {
          actionTaken: 'RETRY_PAYMENT',
          recovered: false
        }
      }
    ];

    setTransactions(mock);
    setSelectedTxn(mock[0]);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((txn) => {
      const matchRisk =
        filterRisk === 'ALL' ||
        txn.aiDiagnosis?.riskLevel === filterRisk;

      const matchStatus =
        filterStatus === 'ALL' ||
        txn.status === filterStatus;

      const query =
        searchQuery.toLowerCase();

      const matchSearch =
        !query ||
        txn.id?.toLowerCase().includes(query) ||
        txn.customer?.name
          ?.toLowerCase()
          .includes(query) ||
        txn.errorCode
          ?.toLowerCase()
          .includes(query);

      return (
        matchRisk &&
        matchStatus &&
        matchSearch
      );
    });
  }, [
    transactions,
    filterRisk,
    filterStatus,
    searchQuery
  ]);

  /*
   * Dashboard KPIs.
   */
  const kpi = useMemo(() => {
    let totalRisk = 0;
    let recovered = 0;
    let failed = 0;
    let blocked = 0;
    let escalations = 0;
    let confSum = 0;
    let confCount = 0;

    transactions.forEach((t) => {
      if (
        t.status === 'FAILED' ||
        t.status === 'ESCALATED'
      ) {
        totalRisk += Number(t.amount || 0);
      }

      if (t.status === 'RECOVERED') {
        recovered += Number(t.amount || 0);
      }

      if (t.status === 'FAILED') {
        failed++;
      }

      if (
        t.policyDecision &&
        t.policyDecision.allowed === false
      ) {
        blocked++;
      }

      if (
        t.status === 'ESCALATED' ||
        t.aiDiagnosis?.recommendedAction ===
          'ESCALATE_TO_HUMAN'
      ) {
        escalations++;
      }

      if (
        Number.isFinite(
          Number(t.aiDiagnosis?.confidence)
        )
      ) {
        confSum += Number(
          t.aiDiagnosis.confidence
        );

        confCount++;
      }
    });

    return {
      totalRisk,
      recovered,
      rate:
        totalRisk > 0
          ? (recovered / totalRisk) * 100
          : 0,
      failed,
      blocked,
      escalations,
      avgConfidence:
        confCount > 0
          ? confSum / confCount
          : 0
    };
  }, [transactions]);

  /*
   * Real evaluation API.
   */
  const runEvaluation = async () => {
    try {
      setEvalRunning(true);

      const res = await fetch(
        '/api/evaluate/run',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            batchSize: Number(evalBatchSize),
            seed: Number.isFinite(
              Number(evalSeed)
            )
              ? Number(evalSeed)
              : 42
          })
        }
      );

      if (!res.ok) {
        throw new Error(
          `Evaluation failed: ${res.status}`
        );
      }

      const data = await res.json();

      /*
       * Backend evaluator returns:
       * recoverAI
       * baseline
       * uplift
       * guardrails
       *
       * The UI below expects the older summary format.
       * Convert the real backend response here.
       */
      const recoverAI = data.recoverAI || {};
      const baseline = data.baseline || {};

      setEvalMetrics({
        batchSize:
          data.count || evalBatchSize,

        seed:
          data.seed ?? evalSeed,

        summary: {
          totalRevenueAtRisk:
            Number(
              recoverAI.revenueAtRisk || 0
            ) * 100,

          recoveredRevenue:
            Number(
              recoverAI.recoveredRevenue || 0
            ) * 100,

          recoveryRate:
            Number(
              recoverAI.recoveryRate || 0
            ) * 100,

          recoveryAttempts:
            Number(
              recoverAI.failed || 0
            ) +
            Number(
              recoverAI.recovered || 0
            ),

          successfulRecoveries:
            Number(
              recoverAI.recovered || 0
            ),

          failedRecoveries:
            Number(
              recoverAI.failed || 0
            ),

          policyBlockedActions:
            Number(
              data.guardrails?.blocked || 0
            ),

          escalations:
            Number(
              data.guardrails?.escalated || 0
            ),

          averageConfidence: 0,

          baselineRecoveredRevenue:
            Number(
              baseline.recoveredRevenue || 0
            ) * 100
        },

        /*
         * Backend currently does not expose
         * category breakdown.
         *
         * Keep this empty instead of inventing
         * fake benchmark data.
         */
        failureCodeBreakdown: []
      });
    } catch (e) {
      console.error(e);

      /*
       * Do NOT fabricate benchmark results.
       * Show an empty state instead.
       */
      setEvalMetrics(null);
    } finally {
      setEvalRunning(false);
    }
  };

  const renderNavLinks = () => (
    <>
      <button
        onClick={() => {
          setActiveTab('transactions');
          setMobileMenuOpen(false);
        }}
        className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
          activeTab === 'transactions'
            ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
            : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
        }`}
      >
        <Activity className="w-4 h-4 shrink-0" />
        <span>Live Interventions</span>
      </button>

      <button
        onClick={() => {
          setActiveTab('evaluation');
          setMobileMenuOpen(false);

          if (!evalMetrics) {
            runEvaluation();
          }
        }}
        className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
          activeTab === 'evaluation'
            ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
            : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
        }`}
      >
        <BarChart3 className="w-4 h-4 shrink-0" />
        <span>Evaluation Benchmark</span>
      </button>

      <button
        onClick={() => {
          setActiveTab('audit');
          setMobileMenuOpen(false);
        }}
        className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
          activeTab === 'audit'
            ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
            : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
        }`}
      >
        <ShieldCheck className="w-4 h-4 shrink-0" />
        <span>Audit Explorer</span>
      </button>
    </>
  );

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 bg-slate-900 border-r border-slate-800 flex-col justify-between shrink-0">
        <div>
          <div className="px-6 py-5 border-b border-slate-800 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-600/30 shrink-0">
              R
            </div>

            <div>
              <span className="font-bold tracking-tight text-white block text-sm">
                RecoverAI
              </span>

              <span className="text-[10px] text-indigo-400 font-mono tracking-wider uppercase block">
                Revenue Agent
              </span>
            </div>
          </div>

          <nav className="p-4 space-y-1.5">
            {renderNavLinks()}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-800/80 bg-slate-900/50">
          <div className="rounded-lg bg-slate-950 p-3 border border-slate-800 text-xs">
            <div className="flex items-center gap-1.5 text-indigo-400 font-semibold mb-1">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              Safety Architecture
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              <span className="text-slate-200 font-medium">
                AI recommends.
              </span>{' '}
              <span className="text-amber-400 font-medium">
                Policy authorizes.
              </span>{' '}
              <span className="text-emerald-400 font-medium">
                Executor executes.
              </span>
            </p>
          </div>
        </div>
      </aside>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
            onClick={() =>
              setMobileMenuOpen(false)
            }
          />

          <div className="relative w-4/5 max-w-xs bg-slate-900 border-r border-slate-800 p-5 flex flex-col justify-between z-10 shadow-2xl">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-md">
                    R
                  </div>

                  <div>
                    <span className="font-bold tracking-tight text-white block text-sm">
                      RecoverAI
                    </span>

                    <span className="text-[10px] text-indigo-400 font-mono uppercase block">
                      Revenue Agent
                    </span>
                  </div>
                </div>

                <button
                  onClick={() =>
                    setMobileMenuOpen(false)
                  }
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <nav className="space-y-1.5">
                {renderNavLinks()}
              </nav>
            </div>

            <div className="rounded-lg bg-slate-950 p-3 border border-slate-800 text-xs">
              <div className="flex items-center gap-1.5 text-indigo-400 font-semibold mb-1">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                Safety Protocol
              </div>

              <p className="text-[10px] text-slate-400 leading-relaxed">
                AI recommends. Policy authorizes. Executor executes.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header */}
        <header className="min-h-16 border-b border-slate-800 px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between bg-slate-900/60 shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() =>
                setMobileMenuOpen(true)
              }
              className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-semibold tracking-tight text-white truncate">
                {activeTab === 'transactions' &&
                  'Autonomous Revenue Recovery Engine'}

                {activeTab === 'evaluation' &&
                  'Benchmark & Decision Evaluation Engine'}

                {activeTab === 'audit' &&
                  'Cryptographic & Policy Audit Explorer'}
              </h1>

              <p className="text-[11px] text-slate-400 hidden sm:block truncate">
                Detect failed payments → Diagnose with AI → Enforce policy → Recover revenue
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <span className="hidden sm:inline-flex px-2.5 py-0.5 rounded-full text-xs font-mono bg-emerald-950 text-emerald-400 border border-emerald-800/80 items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Razorpay Test-Mode
            </span>

            <button
              onClick={fetchData}
              disabled={loading}
              className="px-2.5 sm:px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md border border-slate-700 flex items-center gap-1.5 sm:gap-2 transition shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  loading ? 'animate-spin' : ''
                }`}
              />

              <span className="hidden sm:inline">
                Refresh
              </span>
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8">

          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6 sm:mb-8">

            <div className="bg-slate-900 border border-slate-800 p-3.5 sm:p-4 rounded-xl shadow-sm">
              <span className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider font-semibold block mb-1">
                Revenue At Risk
              </span>

              <div className="text-base sm:text-xl font-bold text-white font-mono truncate">
                {formatINR(kpi.totalRisk)}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 sm:p-4 rounded-xl shadow-sm">
              <span className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider font-semibold block mb-1">
                Recovered
              </span>

              <div className="text-base sm:text-xl font-bold text-emerald-400 font-mono truncate">
                {formatINR(kpi.recovered)}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 sm:p-4 rounded-xl shadow-sm">
              <span className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider font-semibold block mb-1">
                Recovery Rate
              </span>

              <div className="text-base sm:text-xl font-bold text-indigo-400 font-mono truncate">
                {formatPercent(kpi.rate)}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 sm:p-4 rounded-xl shadow-sm">
              <span className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider font-semibold block mb-1">
                Policy Blocks
              </span>

              <div className="text-base sm:text-xl font-bold text-amber-400 font-mono truncate">
                {kpi.blocked}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 sm:p-4 rounded-xl shadow-sm">
              <span className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider font-semibold block mb-1">
                Escalations
              </span>

              <div className="text-base sm:text-xl font-bold text-rose-400 font-mono truncate">
                {kpi.escalations}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 sm:p-4 rounded-xl shadow-sm">
              <span className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider font-semibold block mb-1">
                AI Confidence
              </span>

              <div className="text-base sm:text-xl font-bold text-teal-400 font-mono truncate">
                {formatPercent(
                  kpi.avgConfidence * 100
                )}
              </div>
            </div>
          </div>

          {/* TRANSACTIONS */}
          {activeTab === 'transactions' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

              {/* Transaction Table */}
              <div className="col-span-1 lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm flex flex-col min-w-0">

                <div className="p-3 sm:p-4 border-b border-slate-800 bg-slate-900/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3">

                  <div className="relative flex-1 min-w-0">
                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500 pointer-events-none" />

                    <input
                      type="text"
                      placeholder="Search ID, customer, error..."
                      value={searchQuery}
                      onChange={(e) =>
                        setSearchQuery(e.target.value)
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="flex items-center gap-2">

                    <select
                      value={filterRisk}
                      onChange={(e) =>
                        setFilterRisk(e.target.value)
                      }
                      className="flex-1 sm:flex-none bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="ALL">
                        All Risks
                      </option>

                      <option value="LOW">
                        Low
                      </option>

                      <option value="MEDIUM">
                        Medium
                      </option>

                      <option value="HIGH">
                        High
                      </option>

                      <option value="CRITICAL">
                        Critical
                      </option>
                    </select>

                    <select
                      value={filterStatus}
                      onChange={(e) =>
                        setFilterStatus(e.target.value)
                      }
                      className="flex-1 sm:flex-none bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="ALL">
                        All Statuses
                      </option>

                      <option value="FAILED">
                        Failed
                      </option>

                      <option value="RECOVERED">
                        Recovered
                      </option>

                      <option value="ESCALATED">
                        Escalated
                      </option>
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto w-full">
                  <table className="w-full min-w-[560px] text-left text-xs text-slate-300">

                    <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                      <tr>
                        <th className="py-3 px-4">
                          Transaction ID
                        </th>

                        <th className="py-3 px-4">
                          Customer
                        </th>

                        <th className="py-3 px-4">
                          Amount
                        </th>

                        <th className="py-3 px-4">
                          Error
                        </th>

                        <th className="py-3 px-4">
                          Risk
                        </th>

                        <th className="py-3 px-4">
                          Status
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-800/60">

                      {filteredTransactions.map((t) => (
                        <tr
                          key={t.id}
                          onClick={() =>
                            setSelectedTxn(t)
                          }
                          className={`cursor-pointer transition-colors ${
                            selectedTxn?.id === t.id
                              ? 'bg-indigo-950/40 border-l-2 border-indigo-500'
                              : 'hover:bg-slate-800/40'
                          }`}
                        >

                          <td className="py-3 px-4 font-mono font-medium text-slate-200 whitespace-nowrap">
                            {t.id}
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap">
                            {t.customer?.name ||
                              'Anonymous'}
                          </td>

                          <td className="py-3 px-4 font-mono text-slate-200 whitespace-nowrap">
                            {formatINR(t.amount)}
                          </td>

                          <td className="py-3 px-4 font-mono text-[11px] text-amber-400 whitespace-nowrap">
                            {t.errorCode}
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap">
                            <RiskBadge
                              level={
                                t.aiDiagnosis?.riskLevel
                              }
                            />
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap">
                            <StatusBadge
                              status={t.status}
                            />
                          </td>
                        </tr>
                      ))}

                      {filteredTransactions.length === 0 && (
                        <tr>
                          <td
                            colSpan={6}
                            className="py-8 text-center text-slate-500"
                          >
                            No matching transactions found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Detail */}
              <div className="col-span-1 lg:col-span-5 space-y-4 sm:space-y-6 min-w-0">

                {selectedTxn ? (
                  <>
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6 shadow-sm">

                      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 sm:pb-4 mb-4 border-b border-slate-800">

                        <div>
                          <span className="text-[10px] sm:text-xs text-slate-400 font-mono block">
                            TRANSACTION RECORD
                          </span>

                          <h3 className="text-base sm:text-lg font-bold text-white font-mono break-all">
                            {selectedTxn.id}
                          </h3>
                        </div>

                        <StatusBadge
                          status={selectedTxn.status}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3 sm:gap-4 text-xs mb-4">

                        <div>
                          <span className="text-slate-400 block mb-0.5">
                            Customer
                          </span>

                          <span className="font-semibold text-slate-200 truncate block">
                            {selectedTxn.customer?.name}
                          </span>
                        </div>

                        <div>
                          <span className="text-slate-400 block mb-0.5">
                            Amount
                          </span>

                          <span className="font-semibold text-emerald-400 font-mono">
                            {formatINR(
                              selectedTxn.amount
                            )}
                          </span>
                        </div>

                        <div>
                          <span className="text-slate-400 block mb-0.5">
                            Failure Code
                          </span>

                          <span className="font-mono text-amber-300 break-all">
                            {selectedTxn.errorCode}
                          </span>
                        </div>

                        <div>
                          <span className="text-slate-400 block mb-0.5">
                            Attempt Counter
                          </span>

                          <span className="font-mono text-slate-300">
                            {selectedTxn.attemptCount || 0} of 2
                          </span>
                        </div>
                      </div>

                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 text-xs">

                        <span className="text-slate-500 text-[10px] sm:text-[11px] block font-mono mb-1">
                          GATEWAY ERROR DESCRIPTION
                        </span>

                        <p className="text-slate-300 text-[11px] leading-relaxed">
                          {selectedTxn.errorDescription}
                        </p>
                      </div>
                    </div>

                    {/* Pipeline */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6 shadow-sm space-y-4 sm:space-y-5">

                      <div className="flex items-center justify-between border-b border-slate-800 pb-3">

                        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                          <Layers className="w-4 h-4 text-indigo-400 shrink-0" />
                          Recovery Lifecycle Pipeline
                        </h4>

                        <span className="text-[10px] font-mono text-slate-500">
                          BOUNDED
                        </span>
                      </div>

                      {/* Detection */}
                      <div className="flex gap-3 text-xs">

                        <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 text-[11px] font-bold text-slate-300">
                          1
                        </div>

                        <div className="flex-1 min-w-0">

                          <span className="font-semibold text-slate-200 block">
                            Failure Detection
                          </span>

                          <p className="text-slate-400 text-[11px] mt-0.5 break-words">
                            Backend detected failed payment for{' '}
                            <span className="font-mono text-slate-300">
                              {selectedTxn.id}
                            </span>
                            .
                          </p>
                        </div>
                      </div>

                      {/* AI */}
                      <div className="flex gap-3 text-xs">

                        <div className="w-6 h-6 rounded-full bg-indigo-950 border border-indigo-700 flex items-center justify-center shrink-0 text-[11px] font-bold text-indigo-400">
                          2
                        </div>

                        <div className="flex-1 min-w-0 bg-slate-950 p-3 rounded-lg border border-slate-800">

                          <div className="flex flex-wrap items-center justify-between gap-1 mb-2">

                            <span className="font-semibold text-indigo-400 flex items-center gap-1.5">
                              <Cpu className="w-3.5 h-3.5 shrink-0" />
                              AI Advisory Diagnosis
                            </span>

                            <RiskBadge
                              level={
                                selectedTxn.aiDiagnosis?.riskLevel
                              }
                            />
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] mb-2 font-mono">

                            <div>
                              <span className="text-slate-500 block">
                                Recommendation:
                              </span>

                              <span className="text-slate-200 font-semibold break-all">
                                {selectedTxn.aiDiagnosis?.recommendedAction ||
                                  'Not evaluated'}
                              </span>
                            </div>

                            <div>
                              <span className="text-slate-500 block">
                                Confidence:
                              </span>

                              <span className="text-teal-400 font-semibold">
                                {formatPercent(
                                  (selectedTxn.aiDiagnosis?.confidence ||
                                    0) * 100
                                )}
                              </span>
                            </div>
                          </div>

                          <p className="text-[11px] text-slate-300 italic border-t border-slate-800/80 pt-2 leading-relaxed">
                            {selectedTxn.aiDiagnosis?.reasoningSummary ||
                              'Run the recovery workflow to generate an AI diagnosis.'}
                          </p>
                        </div>
                      </div>

                      {/* Policy */}
                      <div className="flex gap-3 text-xs">

                        <div className="w-6 h-6 rounded-full bg-amber-950 border border-amber-700 flex items-center justify-center shrink-0 text-[11px] font-bold text-amber-400">
                          3
                        </div>

                        <div className="flex-1 min-w-0 bg-slate-950 p-3 rounded-lg border border-slate-800">

                          <div className="flex flex-wrap items-center justify-between gap-1 mb-1">

                            <span className="font-semibold text-amber-400 flex items-center gap-1.5">
                              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                              Policy Engine Verification
                            </span>

                            <span
                              className={`text-[11px] font-bold ${
                                selectedTxn.policyDecision?.allowed
                                  ? 'text-emerald-400'
                                  : 'text-rose-400'
                              }`}
                            >
                              {selectedTxn.policyDecision
                                ? selectedTxn.policyDecision.allowed
                                  ? 'AUTHORIZED'
                                  : 'VETOED / BLOCKED'
                                : 'NOT EVALUATED'}
                            </span>
                          </div>

                          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed break-words">
                            {selectedTxn.policyDecision?.reason ||
                              'Policy decision will appear after recovery evaluation.'}
                          </p>
                        </div>
                      </div>

                      {/* Execution */}
                      <div className="flex gap-3 text-xs">

                        <div className="w-6 h-6 rounded-full bg-emerald-950 border border-emerald-700 flex items-center justify-center shrink-0 text-[11px] font-bold text-emerald-400">
                          4
                        </div>

                        <div className="flex-1 min-w-0 bg-slate-950 p-3 rounded-lg border border-slate-800">

                          <span className="font-semibold text-emerald-400 flex items-center gap-1.5 mb-1">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            Recovery Action Execution
                          </span>

                          <div className="text-[11px] text-slate-300 font-mono break-all">

                            Action Taken:{' '}

                            <span className="text-white font-semibold">
                              {selectedTxn.recoveryResult?.actionTaken ||
                                'Not executed'}
                            </span>
                          </div>

                          {selectedTxn.recoveryResult?.paymentLink && (
                            <div className="mt-2 pt-2 border-t border-slate-800/80">

                              <span className="text-[10px] text-slate-500 block font-mono mb-1">
                                DYNAMIC PAYMENT LINK
                              </span>

                              <a
                                href={
                                  selectedTxn.recoveryResult.paymentLink
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-indigo-400 underline break-all font-mono"
                              >
                                {
                                  selectedTxn.recoveryResult.paymentLink
                                }
                              </a>
                            </div>
                          )}
                        </div>
                      </div>

                    </div>
                  </>
                ) : (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-500 text-xs">
                    Select a transaction from the table.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* EVALUATION */}
          {activeTab === 'evaluation' && (
            <div className="space-y-6">

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">

                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Dynamic Evaluation Run
                  </h3>

                  <p className="text-xs text-slate-400 mt-0.5">
                    Benchmarks RecoverAI against a deterministic baseline using synthetic transactions.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 w-full lg:w-auto">

                  <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg p-1">

                    {[50, 500, 1000].map((size) => (
                      <button
                        key={size}
                        onClick={() =>
                          setEvalBatchSize(size)
                        }
                        className={`px-2.5 sm:px-3 py-1 text-xs font-semibold rounded-md transition ${
                          evalBatchSize === size
                            ? 'bg-indigo-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        N = {size}
                      </button>
                    ))}
                  </div>

                  <input
                    type="text"
                    value={evalSeed}
                    onChange={(e) =>
                      setEvalSeed(e.target.value)
                    }
                    placeholder="PRNG Seed"
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-200 w-32 sm:w-36 focus:outline-none focus:border-indigo-500"
                  />

                  <button
                    onClick={runEvaluation}
                    disabled={evalRunning}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-3.5 sm:px-4 py-1.5 rounded-lg text-xs flex items-center gap-2 shadow-md shadow-indigo-600/20 whitespace-nowrap"
                  >
                    <Play
                      className={`w-3.5 h-3.5 ${
                        evalRunning
                          ? 'animate-spin'
                          : ''
                      }`}
                    />

                    {evalRunning
                      ? 'Evaluating...'
                      : 'Run Simulation'}
                  </button>
                </div>
              </div>

              {evalMetrics && (
                <>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">

                    {/* RecoverAI */}
                    <div className="bg-slate-900 border border-indigo-700/60 rounded-xl p-4 sm:p-6 shadow-md relative overflow-hidden">

                      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">

                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>

                          <h4 className="font-bold text-white text-sm">
                            RecoverAI Pipeline
                          </h4>
                        </div>

                        <span className="text-[10px] sm:text-xs font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                          AI-Diagnosed + Policy-Gated
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mt-4">

                        <div>
                          <span className="text-xs text-slate-400">
                            Recovered Capital
                          </span>

                          <div className="text-xl sm:text-2xl font-bold text-emerald-400 font-mono mt-0.5 truncate">
                            {formatINR(
                              evalMetrics.summary
                                .recoveredRevenue
                            )}
                          </div>
                        </div>

                        <div>
                          <span className="text-xs text-slate-400">
                            Net Recovery Rate
                          </span>

                          <div className="text-xl sm:text-2xl font-bold text-indigo-400 font-mono mt-0.5 truncate">
                            {formatPercent(
                              evalMetrics.summary
                                .recoveryRate
                            )}
                          </div>
                        </div>

                        <div>
                          <span className="text-xs text-slate-400">
                            Policy Blocks
                          </span>

                          <div className="text-sm sm:text-base font-bold text-amber-400 font-mono mt-0.5">
                            {
                              evalMetrics.summary
                                .policyBlockedActions
                            }{' '}
                            retries prevented
                          </div>
                        </div>

                        <div>
                          <span className="text-xs text-slate-400">
                            Escalations
                          </span>

                          <div className="text-sm sm:text-base font-bold text-rose-400 font-mono mt-0.5">
                            {
                              evalMetrics.summary
                                .escalations
                            }{' '}
                            routed to human
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Baseline */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6 shadow-md relative overflow-hidden">

                      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">

                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-slate-500"></span>

                          <h4 className="font-bold text-slate-300 text-sm">
                            Naive Retry Baseline
                          </h4>
                        </div>

                        <span className="text-[10px] sm:text-xs font-mono px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                          Deterministic Baseline
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mt-4">

                        <div>
                          <span className="text-xs text-slate-400">
                            Recovered Capital
                          </span>

                          <div className="text-xl sm:text-2xl font-bold text-slate-300 font-mono mt-0.5 truncate">
                            {formatINR(
                              evalMetrics.summary
                                .baselineRecoveredRevenue
                            )}
                          </div>
                        </div>

                        <div>
                          <span className="text-xs text-slate-400">
                            Comparison
                          </span>

                          <div className="text-xl sm:text-2xl font-bold text-indigo-400 font-mono mt-0.5 truncate">
                            +
                            {formatINR(
                              evalMetrics.summary
                                .recoveredRevenue -
                                evalMetrics.summary
                                  .baselineRecoveredRevenue
                            )}
                          </div>
                        </div>

                        <div className="col-span-2 bg-slate-950 p-3 rounded-lg border border-slate-800/80 text-xs text-slate-400 leading-relaxed">
                          RecoverAI recovered{' '}
                          <span className="text-emerald-400 font-bold">
                            {formatINR(
                              evalMetrics.summary
                                .recoveredRevenue
                            )}
                          </span>{' '}
                          versus{' '}
                          <span className="text-slate-300 font-bold">
                            {formatINR(
                              evalMetrics.summary
                                .baselineRecoveredRevenue
                            )}
                          </span>{' '}
                          for the baseline.
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Guardrail summary */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6">

                    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-4">
                      Evaluation Guardrails
                    </h4>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

                      <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                        <span className="text-[10px] text-slate-500 block">
                          Batch
                        </span>

                        <span className="text-lg font-mono font-bold text-white">
                          {evalMetrics.batchSize}
                        </span>
                      </div>

                      <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                        <span className="text-[10px] text-slate-500 block">
                          Recovery Attempts
                        </span>

                        <span className="text-lg font-mono font-bold text-white">
                          {
                            evalMetrics.summary
                              .recoveryAttempts
                          }
                        </span>
                      </div>

                      <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                        <span className="text-[10px] text-slate-500 block">
                          Escalations
                        </span>

                        <span className="text-lg font-mono font-bold text-rose-400">
                          {
                            evalMetrics.summary
                              .escalations
                          }
                        </span>
                      </div>

                      <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                        <span className="text-[10px] text-slate-500 block">
                          Policy Blocks
                        </span>

                        <span className="text-lg font-mono font-bold text-amber-400">
                          {
                            evalMetrics.summary
                              .policyBlockedActions
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {!evalMetrics && !evalRunning && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center">

                  <BarChart3 className="w-8 h-8 text-slate-600 mx-auto mb-3" />

                  <p className="text-sm text-slate-400">
                    Run a simulation to view the real backend evaluation results.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* AUDIT */}
          {activeTab === 'audit' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">

              <div className="p-4 border-b border-slate-800 bg-slate-900/60 flex flex-wrap items-center justify-between gap-2">

                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Immutable Decision Log
                  </h3>

                  <p className="text-xs text-slate-400 mt-0.5">
                    Audit trail for AI rationale, policy authorization, and execution outcomes.
                  </p>
                </div>

                <span className="text-xs font-mono text-slate-400">
                  Total Entries:{' '}
                  <span className="text-white font-semibold">
                    {auditLogs.length}
                  </span>
                </span>
              </div>

              <div className="overflow-x-auto w-full">

                <table className="w-full min-w-[620px] text-left text-xs text-slate-300">

                  <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">

                    <tr>
                      <th className="py-3 px-4">
                        Timestamp
                      </th>

                      <th className="py-3 px-4">
                        Event
                      </th>

                      <th className="py-3 px-4">
                        Action
                      </th>

                      <th className="py-3 px-4">
                        Result
                      </th>

                      <th className="py-3 px-4">
                        Policy
                      </th>

                      <th className="py-3 px-4">
                        Details
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">

                    {auditLogs.map((log, idx) => (
                      <tr
                        key={
                          log.eventId || idx
                        }
                        className="hover:bg-slate-800/30"
                      >

                        <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                          {log.timestamp
                            ? new Date(
                                log.timestamp
                              ).toLocaleTimeString()
                            : 'N/A'}
                        </td>

                        <td className="py-3 px-4 text-indigo-300 font-semibold whitespace-nowrap">
                          {log.eventType ||
                            'EVENT'}
                        </td>

                        <td className="py-3 px-4 text-slate-200 whitespace-nowrap">
                          {log.action ||
                            'N/A'}
                        </td>

                        <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                          {log.result ||
                            'N/A'}
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          {log.policyVersion ||
                            'N/A'}
                        </td>

                        <td className="py-3 px-4 font-sans text-slate-300 max-w-xs truncate">
                          {log.metadata
                            ? JSON.stringify(
                                log.metadata
                              )
                            : 'No metadata'}
                        </td>
                      </tr>
                    ))}

                    {auditLogs.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="py-8 text-center text-slate-500 font-sans"
                        >
                          No audit events captured yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

ReactDOM.createRoot(
  document.getElementById('root')
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);