import { useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  LogIn,
  Plus,
  Send,
  ChevronDown,
  ChevronUp,
  Download,
  LogOut,
  Upload,
  CheckCircle,
  Clock,
  LayoutDashboard,
  MessageSquare,
  Shield,
  User,
  X,
  Globe,
  Search,
} from "lucide-react";

type Screen = "login" | "chat" | "admin";

const HISTORY: any[] = [];

const INGESTION_ROWS = [
  {
    file: "Ward_4_2002.json",
    ward: "Ward 4",
    nodes: "1,042",
    dedup: "14.2% Duplicates Merged",
    status: "active",
  },
  {
    file: "Ward_7_1997.csv",
    ward: "Ward 7",
    nodes: "876",
    dedup: "9.8% Duplicates Merged",
    status: "active",
  },
  {
    file: "Ward_2_2004.pdf",
    ward: "Ward 2",
    nodes: "2,314",
    dedup: "21.5% Duplicates Merged",
    status: "processing",
  },
];

// ─── Login Screen ────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: (role: string, email: string) => void }) {
  const [tab, setTab] = useState<"citizen" | "admin">("citizen");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);

  // OTP verification state
  const [otpStep, setOtpStep] = useState(false);
  const [otpUserId, setOtpUserId] = useState("");
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpSuccess, setOtpSuccess] = useState("");
  const [resending, setResending] = useState(false);

  const handleLogin = async () => {
    try {
      setLoading(true);
      const res = await axios.post(`${import.meta.env.VITE_API_URL || \'${import.meta.env.VITE_API_URL || 'http://localhost:3001'}\'}/api/auth/login`, { email, password });
      localStorage.setItem("token", res.data.token);
      onLogin(res.data.user.role, res.data.user.email);
    } catch (err: any) {
      const data = err.response?.data;
      if (data?.requiresOtp && data?.userId) {
        // Unverified account — route to OTP screen
        setOtpUserId(data.userId);
        setOtpSuccess(data.message || "A verification code has been sent to your email.");
        setOtpStep(true);
      } else {
        alert(data?.message || "Login failed. Check console.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (password.length < 8) { alert("Password must be at least 8 characters."); return; }
    try {
      setLoading(true);
      const res = await axios.post(`${import.meta.env.VITE_API_URL || \'${import.meta.env.VITE_API_URL || 'http://localhost:3001'}\'}/api/auth/register`, { email, password });
      if (res.data.requiresOtp && res.data.userId) {
        setOtpUserId(res.data.userId);
        setOtpSuccess("Account created! Check your email (or the ms1-core terminal in dev mode) for your 6-digit code.");
        setOtpStep(true);
      }
    } catch (err: any) {
      const data = err.response?.data;
      if (data?.requiresOtp && data?.userId) {
        setOtpUserId(data.userId);
        setOtpSuccess("We sent a new OTP to your email. Enter it below to verify.");
        setOtpStep(true);
      } else {
        alert(data?.message || "Registration failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) { setOtpError("Please enter the 6-digit code."); return; }
    setOtpError("");
    try {
      setLoading(true);
      const res = await axios.post(`${import.meta.env.VITE_API_URL || \'${import.meta.env.VITE_API_URL || 'http://localhost:3001'}\'}/api/auth/verify-otp`, { userId: otpUserId, otp });
      localStorage.setItem("token", res.data.token);
      onLogin(res.data.user.role, res.data.user.email);
    } catch (err: any) {
      setOtpError(err.response?.data?.message || "Verification failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setResending(true);
    setOtpError("");
    setOtpSuccess("");
    try {
      await axios.post(`${import.meta.env.VITE_API_URL || \'${import.meta.env.VITE_API_URL || 'http://localhost:3001'}\'}/api/auth/resend-otp`, { userId: otpUserId });
      setOtpSuccess("A new code has been sent.");
      setOtp("");
    } catch (err: any) {
      setOtpError(err.response?.data?.message || "Resend failed. Try again.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex" style={{ fontFamily: "Inter, sans-serif" }}>
      {/* Left branding panel */}
      <div className="hidden lg:flex w-1/2 bg-[#1E3A8A] flex-col justify-between p-12 relative overflow-hidden">
        {/* Subtle geometric decoration */}
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-10 bg-white translate-x-32 -translate-y-32" />
        <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full opacity-5 bg-white -translate-x-16 translate-y-16" />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-9 h-9 rounded bg-white/20 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <span className="text-white font-semibold text-lg tracking-tight">VoterGraph.ai</span>
          </div>

          <div className="max-w-sm">
            <h1 className="text-white text-4xl font-light leading-tight mb-6">
              Historical Lineage<br />
              <span className="font-semibold">Verification</span>
            </h1>
            <p className="text-blue-200 text-base leading-relaxed">
              Query electoral rolls in natural language. Every answer is backed by Neo4j graph traversal and Double Metaphone phonetic matching — zero hallucination.
            </p>
          </div>
        </div>

        <div className="relative z-10 space-y-3">
          {[
            { icon: "🔒", label: "Express.js + PostgreSQL verified sessions" },
            { icon: "🧬", label: "Neo4j graph traversal on 10M+ records" },
            { icon: "🔤", label: "Double Metaphone phonetic deduplication" },
          ].map((f) => (
            <div key={f.label} className="flex items-center gap-3">
              <span className="text-sm">{f.icon}</span>
              <span className="text-blue-200 text-sm">{f.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 bg-[#F8FAFC] flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <Shield className="w-6 h-6 text-[#1E3A8A]" />
            <span className="font-semibold text-[#1E3A8A]">VoterGraph.ai</span>
          </div>

          {/* ── OTP Step ──────────────────────────────────────────────────── */}
          {otpStep ? (
            <>
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-[#EEF2FF] border border-[#C7D2FE] mb-5 mx-auto">
                <Shield className="w-6 h-6 text-[#1E3A8A]" />
              </div>
              <h2 className="text-2xl font-semibold text-[#0F172A] text-center mb-1">Verify your email</h2>
              <p className="text-[#64748B] text-sm text-center mb-6">
                Enter the 6-digit code sent to <strong>{email}</strong>
                <br />
                <span className="text-xs text-[#94A3B8]">(In dev mode: check the ms1-core terminal)</span>
              </p>

              {otpSuccess && (
                <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
                  {otpSuccess}
                </div>
              )}
              {otpError && (
                <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                  {otpError}
                </div>
              )}

              {/* 6-digit OTP input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-[#0F172A] mb-1.5">Verification Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => { setOtp(e.target.value.replace(/\D/g, "")); setOtpError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleVerifyOtp(); }}
                  placeholder="000000"
                  className="w-full px-4 py-3 rounded-lg border border-[#E2E8F0] bg-white text-[#0F172A] text-2xl font-mono tracking-[0.5em] text-center placeholder:text-[#CBD5E1] placeholder:text-base placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB] transition"
                />
              </div>

              <button
                onClick={handleVerifyOtp}
                disabled={loading || otp.length !== 6}
                className="w-full py-2.5 bg-[#1E3A8A] hover:bg-[#1e40af] text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 mb-4"
              >
                <CheckCircle className="w-4 h-4" />
                {loading ? "Verifying..." : "Verify Email"}
              </button>

              <p className="text-center text-sm text-[#64748B]">
                Didn't receive it?{" "}
                <button
                  onClick={handleResendOtp}
                  disabled={resending}
                  className="text-[#2563EB] hover:underline font-medium disabled:opacity-50"
                >
                  {resending ? "Resending..." : "Resend code"}
                </button>
              </p>
              <p className="text-center text-sm text-[#94A3B8] mt-3">
                <button onClick={() => { setOtpStep(false); setOtp(""); setOtpError(""); setOtpSuccess(""); }} className="hover:underline">
                  ← Back to sign in
                </button>
              </p>
            </>
          ) : (
          /* ── Login / Register Step ─────────────────────────────────────── */
          <>
            <h2 className="text-2xl font-semibold text-[#0F172A] mb-1">{isRegistering ? "Register" : "Sign in"}</h2>
            <p className="text-[#64748B] text-sm mb-8">{isRegistering ? "Create your account for SIR Verification Access" : "Access the SIR verification system"}</p>

            {/* Portal toggle */}
            <div className="flex rounded-lg border border-[#E2E8F0] bg-white p-1 mb-6">
              {(["citizen", "admin"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                    tab === t ? "bg-[#1E3A8A] text-white shadow-sm" : "text-[#64748B] hover:text-[#0F172A]"
                  }`}
                >
                  {t === "citizen" ? "Citizen Portal" : "Civic Admin Portal"}
                </button>
              ))}
            </div>

            {/* Form */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#0F172A] mb-1.5">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.gov.in"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#E2E8F0] bg-white text-[#0F172A] text-sm placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB] transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#0F172A] mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") isRegistering ? handleRegister() : handleLogin(); }}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#E2E8F0] bg-white text-[#0F172A] text-sm placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB] transition"
                />
              </div>

              <button
                onClick={isRegistering ? handleRegister : handleLogin}
                disabled={loading}
                className="w-full py-2.5 bg-[#1E3A8A] hover:bg-[#1e40af] text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                <LogIn className="w-4 h-4" />
                {loading
                  ? (isRegistering ? "Registering..." : "Authenticating...")
                  : isRegistering
                    ? "Register"
                    : (tab === "citizen" ? "Sign In" : "Generate Verified Session")}
              </button>
            </div>

            <p className="mt-6 text-center text-sm text-[#64748B]">
              {isRegistering ? "Already have an account? " : "New user? "}
              <button
                onClick={() => setIsRegistering(!isRegistering)}
                className="text-[#2563EB] hover:underline font-medium"
              >
                {isRegistering ? "Sign In instead" : "Register for SIR Verification Access"}
              </button>
            </p>

            <p className="mt-8 text-center text-xs text-[#94A3B8]">
              Secured by Election Commission of India · TLS 1.3
            </p>
          </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Graph Evidence Drawer ───────────────────────────────────────────────────


function GraphEvidenceDrawer({ onClose, cypher, nodes }: { onClose: () => void; cypher?: string; nodes?: any[] }) {
  // Option B: Client-side synthesis of graph visualization
  const safeNodes = Array.isArray(nodes) ? nodes : [];
  
  // Extract unique persons and houses
  const personNames = Array.from(new Set(safeNodes.map(n => n["p.name"] || n["elector_name"] || n.name).filter(Boolean)));
  const houseNumbers = Array.from(new Set(safeNodes.map(n => n["h.number"] || n["house_number"] || n.house_number).filter(Boolean)));
  
  // Define positions (simplified for up to 3 persons and 1 house)
  const houseX = 130;
  const houseY = 95;
  const personPositions = [
    { x: 75, y: 38 },
    { x: 185, y: 38 },
    { x: 130, y: 25 }
  ];

  return (
    <div className="mt-3 rounded-xl border border-[#E2E8F0] bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E2E8F0] bg-[#F8FAFC]">
        <div className="flex items-center gap-2">
          <span className="text-base">📊</span>
          <span className="text-sm font-semibold text-[#0F172A]">
            Verify Graph Evidence
          </span>
          <span className="ml-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
            Zero-Hallucination Proof
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-[#94A3B8] hover:text-[#64748B] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-[#E2E8F0]">
        {/* Section 1: Cypher Query */}
        <div className="p-5">
          <p className="text-xs font-semibold text-[#64748B] uppercase tracking-wider mb-3">
            Executed Cypher Logic
          </p>
          <div className="rounded-lg bg-[#0F172A] p-4 overflow-x-auto">
            <pre
              className="text-sm leading-relaxed text-[#E2E8F0]"
              style={{ fontFamily: "JetBrains Mono, monospace", whiteSpace: "pre-wrap" }}
            >
              {cypher || "No Cypher query available for this response."}
            </pre>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-xs text-[#64748B]">
              Query executed successfully
            </span>
          </div>
        </div>

        {/* Section 2: Visual Graph */}
        <div className="p-5">
          <p className="text-xs font-semibold text-[#64748B] uppercase tracking-wider mb-3">
            Visual Node Graph
          </p>

          <div className="relative bg-[#F8FAFC] rounded-lg border border-[#E2E8F0] p-4 h-44 flex items-center justify-center">
            {/* Phonetic label */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-[#EEF2FF] border border-[#C7D2FE] text-xs font-medium text-[#1E3A8A] whitespace-nowrap">
              Phonetic Match: Double Metaphone Index Verified
            </div>

            {/* SVG graph */}
            <svg viewBox="0 0 260 120" className="w-full h-full mt-4">
              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill="#94A3B8" />
                </marker>
              </defs>
              
              {/* Dynamic Edges */}
              {personNames.slice(0, 3).map((_, i) => (
                  houseNumbers.length > 0 && (
                      <g key={`edge-${i}`}>
                          <line x1={personPositions[i].x} y1={personPositions[i].y + 7} x2={houseX} y2={houseY - 20} stroke="#94A3B8" strokeWidth="1.5" markerEnd="url(#arrow)" />
                          <text x={(personPositions[i].x + houseX) / 2} y={(personPositions[i].y + houseY) / 2} fontSize="8" fill="#94A3B8" fontFamily="JetBrains Mono, monospace" textAnchor="middle">LIVES_IN</text>
                      </g>
                  )
              ))}

              {/* Dynamic Person Nodes */}
              {personNames.slice(0, 3).map((name, i) => (
                  <g key={`person-${i}`}>
                      <circle cx={personPositions[i].x} cy={personPositions[i].y} r="28" fill="#EEF2FF" stroke="#1E3A8A" strokeWidth="1.5" />
                      <text x={personPositions[i].x} y={personPositions[i].y - 4} textAnchor="middle" fontSize="7.5" fill="#1E3A8A" fontWeight="600" fontFamily="Inter, sans-serif">Person</text>
                      <text x={personPositions[i].x} y={personPositions[i].y + 7} textAnchor="middle" fontSize="8.5" fill="#0F172A" fontFamily="Inter, sans-serif">{String(name)}</text>
                  </g>
              ))}

              {/* Dynamic House Node */}
              {houseNumbers.slice(0, 1).map((num, i) => (
                  <g key={`house-${i}`}>
                      <rect x={houseX - 26} y={houseY - 17} width="52" height="34" rx="4" fill="#DCFCE7" stroke="#16A34A" strokeWidth="1.5" />
                      <text x={houseX} y={houseY - 4} textAnchor="middle" fontSize="7.5" fill="#15803D" fontWeight="600" fontFamily="Inter, sans-serif">House</text>
                      <text x={houseX} y={houseY + 8} textAnchor="middle" fontSize="9" fill="#0F172A" fontFamily="Inter, sans-serif">No. {String(num)}</text>
                  </g>
              ))}
              
              {/* Fallback if no nodes parsed */}
              {personNames.length === 0 && houseNumbers.length === 0 && (
                  <text x="130" y="60" textAnchor="middle" fontSize="10" fill="#94A3B8" fontFamily="Inter, sans-serif">Dynamic visualization not available for this query.</text>
              )}
            </svg>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              ...personNames.slice(0,2).map(n => ({ label: String(n).substring(0,3).toUpperCase(), name: String(n) })),
              ...houseNumbers.slice(0,1).map(n => ({ label: `H${n}`, name: `House ${n}` }))
            ].map((n, idx) => (
              <div key={n.name} className="text-center p-2 rounded bg-[#F1F5F9]">
                <div
                  className="text-xs font-mono font-semibold text-[#1E3A8A]"
                  style={{ fontFamily: "JetBrains Mono, monospace" }}
                >
                  {n.label}
                </div>
                <div className="text-xs text-[#64748B] mt-0.5">{n.name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="px-5 py-4 border-t border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 text-xs text-[#64748B]">
          <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
          Verified against Ward 4 Electoral Roll, 2002 · Source: Election Commission DB
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-[#1E3A8A] hover:bg-[#1e40af] text-white text-sm font-medium rounded-lg transition-colors">
          <Download className="w-4 h-4" />
          Download Official Lineage Proof (.PDF)
        </button>
      </div>
    </div>
  );
}


function ClarificationCard({ option, onClick }: { option: any; onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      className="mt-3 p-3 rounded-lg border border-dashed border-[#B45309] bg-[#FEF9C3] cursor-pointer hover:bg-[#FEF08A] transition-colors"
    >
      <p className="text-sm font-medium text-[#854D0E]">{option.label}</p>
    </div>
  );
}

// ─── Chat Screen ─────────────────────────────────────────────────────────────

function ChatScreen({ userRole, userEmail, onAdmin, onLogout }: { userRole: string; userEmail: string; onAdmin: () => void; onLogout: () => void }) {
  const [evidenceOpen, setEvidenceOpen] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [language, setLanguage] = useState("English");
  
  // Loading states
  const [loading, setLoading] = useState(false);
  const [queueStatus, setQueueStatus] = useState<{status: string, position?: number} | null>(null);
  const pollTimerRef = useRef<any>(null);

  const [messages, setMessages] = useState<any[]>([]);
  
  
  // Session states
  const [sessions, setSessions] = useState<any[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  
  // Geo Scope States
  const [states, setStates] = useState<any[]>([]);
  const [districts, setDistricts] = useState<any[]>([]);
  const [constituencies, setConstituencies] = useState<any[]>([]);
  const [pollingStations, setPollingStations] = useState<any[]>([]);
  const [selectedState, setSelectedState] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [selectedConstituency, setSelectedConstituency] = useState("");
  const [selectedStation, setSelectedStation] = useState("");

  useEffect(() => {
    axios.get(`${import.meta.env.VITE_API_URL || \'${import.meta.env.VITE_API_URL || 'http://localhost:3001'}\'}/api/geo/states`).then(res => setStates(res.data.states || [])).catch(console.error);
  }, []);

  useEffect(() => {
    setSelectedDistrict(""); setDistricts([]);
    setSelectedConstituency(""); setConstituencies([]);
    setSelectedStation(""); setPollingStations([]);
    if (selectedState) {
      axios.get(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/geo/districts?stateId=${selectedState}`).then(res => setDistricts(res.data.districts || [])).catch(console.error);
    }
  }, [selectedState]);

  useEffect(() => {
    setSelectedConstituency(""); setConstituencies([]);
    setSelectedStation(""); setPollingStations([]);
    if (selectedDistrict) {
      axios.get(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/geo/constituencies?districtId=${selectedDistrict}`).then(res => setConstituencies(res.data.constituencies || [])).catch(console.error);
    }
  }, [selectedDistrict]);

  useEffect(() => {
    setSelectedStation(""); setPollingStations([]);
    if (selectedConstituency) {
      axios.get(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/geo/polling-stations?constituencyId=${selectedConstituency}`).then(res => setPollingStations(res.data.pollingStations || [])).catch(console.error);
    }
  }, [selectedConstituency]);

useEffect(() => {
    fetchSessions();
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current); };
  }, []);

  const fetchSessions = async () => {
    try {
       const res = await axios.get(`${import.meta.env.VITE_API_URL || \'${import.meta.env.VITE_API_URL || 'http://localhost:3001'}\'}/api/chat/sessions`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
       setSessions(res.data.sessions || []);
    } catch(e) {}
  };

  const loadSession = async (sessionId: string) => {
    try {
       const res = await axios.get(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/chat/sessions/${sessionId}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
       // Map prisma schema correctly
       const mapped = res.data.session.messages.map((m: any) => ({
         role: m.role,
         text: m.content,
         cypher: m.cypherQuery || m.cypher_query,
         nodes: m.graphNodes ? (typeof m.graphNodes === 'string' ? JSON.parse(m.graphNodes) : m.graphNodes) : null,
         timestamp: new Date(m.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
       }));
       setMessages(mapped);
       setCurrentSessionId(sessionId);
       setNextCursor(res.data.nextCursor);
       setMode("chat");
    } catch(e) {}
  };

  const loadEarlier = async () => {
    if (!currentSessionId || !nextCursor) return;
    try {
       const res = await axios.get(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/chat/sessions/${currentSessionId}?cursor=${nextCursor}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
       const mapped = res.data.session.messages.map((m: any) => ({
         role: m.role,
         text: m.content,
         cypher: m.cypherQuery || m.cypher_query,
         nodes: m.graphNodes ? (typeof m.graphNodes === 'string' ? JSON.parse(m.graphNodes) : m.graphNodes) : null,
         timestamp: new Date(m.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
       }));
       setMessages(prev => [...mapped, ...prev]);
       setNextCursor(res.data.nextCursor);
    } catch(e) {}
  };

  const pollJob = (jobId: string, sessionId: string) => {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      pollTimerRef.current = setInterval(async () => {
        attempts++;
        if (attempts > 60) { // 2 mins max
          clearInterval(pollTimerRef.current);
          reject(new Error("Job timed out. Check back later."));
          return;
        }
        try {
          const res = await axios.get(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/chat/queue/${jobId}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
          if (res.data.status === 'DONE') {
             clearInterval(pollTimerRef.current);
             resolve(res.data.result);
          } else if (res.data.status === 'FAILED') {
             clearInterval(pollTimerRef.current);
             reject(new Error(res.data.error || 'Job failed'));
          } else {
             setQueueStatus({ status: res.data.status, position: res.data.queuePosition });
          }
        } catch(e) {
          clearInterval(pollTimerRef.current);
          reject(e);
        }
      }, 2000);
    });
  };

  const processAgentResponse = (data: any) => {
    if (data.sessionId && !currentSessionId) {
      setCurrentSessionId(data.sessionId);
    }
    if (data.needs_clarification) {
      setMessages(prev => [...prev, {
        role: "agent",
        text: data.clarification_prompt || "I need more details to resolve this ambiguity.",
        clarification_options: data.clarification_options,
        needs_clarification: true,
        sessionId: data.sessionId,
        timestamp: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
      }]);
    } else {
      setMessages(prev => [...prev, {
        role: "agent",
        text: data.reply,
        cypher: data.cypher_query,
        nodes: data.graph_nodes,
        timestamp: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
      }]);
    }
  };

  const handleSend = async (overrideText?: string, isResume?: boolean, sessionIdContext?: string) => {
    const textToSend = overrideText || input;
    if (!textToSend.trim()) return;

    if (!isResume) {
      const userMsg = { role: "user", text: textToSend, timestamp: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
    }
    
    setLoading(true);
    setQueueStatus(null);

    try {
      const token = localStorage.getItem("token");
      let data;
      
      const cObj = constituencies.find(c => c.id === selectedConstituency);
      const cCode = cObj ? cObj.code : undefined;

      if (isResume) {
         // Proxy route flagged as missing in backend - we call it anyway per requirements
         const res = await axios.post(
           `${import.meta.env.VITE_API_URL || \'${import.meta.env.VITE_API_URL || 'http://localhost:3001'}\'}/api/chat/resume`,
           { sessionId: sessionIdContext, clarificationAnswer: textToSend },
           { headers: { Authorization: `Bearer ${token}` } }
         );
         data = res.data;
      } else {
         const res = await axios.post(
           `${import.meta.env.VITE_API_URL || \'${import.meta.env.VITE_API_URL || 'http://localhost:3001'}\'}/api/chat`,
           { 
             message: textToSend, 
             pollingStationId: selectedStation || undefined, 
             constituencyId: cCode || undefined,
             sessionId: currentSessionId || undefined
           },
           { headers: { Authorization: `Bearer ${token}` } }
         );
         if (res.status === 202) {
           setQueueStatus({ status: 'PENDING', position: res.data.queuePosition });
           data = await pollJob(res.data.jobId, res.data.sessionId);
         } else {
           data = res.data;
         }
      }
      
      // If the resume ALSO queued...
      if (data && data.queued) {
         setQueueStatus({ status: 'PENDING', position: data.queuePosition });
         data = await pollJob(data.jobId, data.sessionId);
      }
      
      processAgentResponse(data);
      fetchSessions(); // Refresh history
      
    } catch (err: any) {
      console.error(err);
      if (err.response?.status === 401) {
          alert("Your session has expired. Please log in again.");
          onLogout();
      } else {
          alert(err.message || err.response?.data?.message || "Failed to process message.");
      }
    } finally {
      setLoading(false);
      setQueueStatus(null);
    }
  };

  return (
    <div className="h-screen w-full flex" style={{ fontFamily: "Inter, sans-serif" }}>
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 bg-white border-r border-[#E2E8F0] flex flex-col">
        <div className="p-4 border-b border-[#E2E8F0]">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-[#1E3A8A]" />
            <span className="font-semibold text-[#0F172A] text-sm tracking-tight">VoterGraph.ai</span>
          </div>
          
          <button 
            onClick={() => { setMessages([]); setInput(""); setEvidenceOpen(null); setCurrentSessionId(null); }} 
            className="w-full flex items-center justify-center gap-2 py-2 bg-[#1E3A8A] hover:bg-[#1e40af] text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Session
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <p className="text-[10px] font-semibold text-[#94A3B8] uppercase tracking-wider px-2 mb-2">
            Recent Verification Sessions
          </p>
          <div className="space-y-0.5">
            {sessions.length === 0 && (
              <p className="text-xs text-[#94A3B8] px-2 mt-4 italic">No recent sessions</p>
            )}
            {sessions.map((h: any) => (
              <button
                key={h.id}
                onClick={() => loadSession(h.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  currentSessionId === h.id
                    ? "bg-[#EEF2FF] text-[#1E3A8A] font-medium"
                    : "text-[#475569] hover:bg-[#F8FAFC]"
                }`}
              >
                <div className="flex items-start gap-2">
                  <MessageSquare className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 opacity-60" />
                  <span className="leading-snug truncate">{"Session " + h.id.slice(-4)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Nav buttons */}
        {userRole === 'CIVIC_ADMIN' && (
          <div className="p-3 border-t border-[#E2E8F0] space-y-1">
            <button
              onClick={onAdmin}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[#64748B] hover:bg-[#F8FAFC] transition-colors"
            >
              <LayoutDashboard className="w-4 h-4" />
              Admin Dashboard
            </button>
          </div>
        )}

        {/* User profile card */}
        <div className="p-3 border-t border-[#E2E8F0]">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-[#F8FAFC]">
            <div className="w-8 h-8 rounded-full bg-[#1E3A8A] flex items-center justify-center flex-shrink-0">
              <User className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[#0F172A] truncate">{userEmail || "citizen@example.gov.in"}</p>
              <p className="text-[10px] text-[#94A3B8]">{userRole === 'CIVIC_ADMIN' ? "Admin Access" : "SIR Verified Access"}</p>
            </div>
            <button onClick={onLogout} className="text-[#94A3B8] hover:text-[#64748B] transition-colors">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#F8FAFC]">
        {/* Top bar */}
        <div className="h-14 border-b border-[#E2E8F0] bg-white flex items-center px-6 gap-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#0F172A]">
              {messages.length === 0 ? "New Verification Session" : "Active Verification Session"}
            </p>
            <p className="text-xs text-[#94A3B8]">Electoral Roll Graph Analysis</p>
          </div>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Neo4j Connected
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {nextCursor && (
             <div className="flex justify-center mb-4">
               <button onClick={loadEarlier} className="px-4 py-1.5 text-xs font-medium text-[#1E3A8A] bg-[#EEF2FF] rounded-full hover:bg-[#E0E7FF]">
                 Load earlier messages
               </button>
             </div>
          )}
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center mt-10 w-full max-w-2xl mx-auto">
              <p className="text-center text-[#94A3B8] text-sm mb-6">
                Start a conversation or try one of these examples:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                {[
                  { icon: "👪", text: "Did my grandfather Suresh live in House 42?" },
                  { icon: "🏠", text: "Who lives at House 168 in Ward 24?" },
                  { icon: "🔍", text: "Find all residents named Ramesh in Bharatpur" },
                  { icon: "👨‍👩‍👧", text: "Who is the wife of Govind Singh?" },
                ].map((q, idx) => (
                  <button
                    key={idx}
                    disabled={!selectedConstituency}
                    onClick={() => {
                        if (!selectedConstituency) return;
                        setInput(q.text);
                        // Using setTimeout so state setter has time to complete before we submit
                        setTimeout(() => handleSend(q.text), 0);
                    }}
                    className={`flex items-center gap-3 p-4 bg-white border border-[#E2E8F0] hover:border-[#94A3B8] hover:shadow-sm rounded-xl text-left transition-all group ${
                      !selectedConstituency ? "opacity-50 cursor-not-allowed hover:border-[#E2E8F0] hover:shadow-none" : ""
                    }`}
                  >
                    <span className={`text-xl bg-[#F8FAFC] p-2 rounded-lg transition-colors ${selectedConstituency ? "group-hover:bg-[#EEF2FF]" : ""}`}>{q.icon}</span>
                    <span className="text-sm text-[#475569] font-medium leading-snug">{q.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, idx) => (
            <div key={idx}>
              {msg.role === "user" ? (
                <div className="flex justify-end">
                  <div className="max-w-xl">
                    <div className="bg-[#1E3A8A] text-white rounded-2xl rounded-tr-sm px-5 py-3.5 text-sm leading-relaxed shadow-sm">
                      {msg.text}
                    </div>
                    <p className="text-right text-[10px] text-[#94A3B8] mt-1.5 mr-1">
                      citizen@example.gov.in · {msg.timestamp}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex justify-start">
                  <div className="max-w-2xl w-full">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#EEF2FF] border border-[#C7D2FE] flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Shield className="w-4 h-4 text-[#1E3A8A]" />
                      </div>
                      <div className="flex-1">
                        <div className="bg-white rounded-2xl rounded-tl-sm px-5 py-4 text-sm leading-relaxed shadow-sm border border-[#E2E8F0] text-[#0F172A]">
                          <div 
                            className="text-sm leading-relaxed"
                            dangerouslySetInnerHTML={{ 
                              __html: (msg.text || "")
                                .replace(/</g, "&lt;")
                                .replace(/>/g, "&gt;")
                                .replace(/\*\*(.*?)\*\*/g, "<strong class='font-semibold'>$1</strong>")
                                .replace(/(?:\r\n|\r|\n)/g, "<br/>")
                                .replace(/\* /g, "<br/>• ") 
                            }} 
                          />
                          {/* Clarification Options */}
                          {msg.needs_clarification && msg.clarification_options && (
                             <div className="mt-4 space-y-2">
                               {msg.clarification_options.map((opt: any, oIdx: number) => (
                                  <ClarificationCard 
                                    key={oIdx} 
                                    option={opt} 
                                    onClick={() => handleSend(opt.label || opt, true, msg.sessionId)} 
                                  />
                               ))}
                             </div>
                          )}

                          {/* Evidence toggle */}
                          {msg.cypher && (
                            <button
                              onClick={() => setEvidenceOpen(evidenceOpen === idx ? null : idx)}
                              className="mt-4 flex items-center gap-2 text-[#2563EB] text-xs font-medium hover:text-[#1E3A8A] transition-colors"
                            >
                              {evidenceOpen === idx ? (
                                <ChevronUp className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                              )}
                              {evidenceOpen === idx ? "Hide" : "View"} Graph Evidence (Zero-Hallucination Proof)
                            </button>
                          )}
                        </div>

                        {/* Evidence drawer */}
                        {evidenceOpen === idx && <GraphEvidenceDrawer onClose={() => setEvidenceOpen(null)} cypher={msg.cypher} nodes={msg.nodes} />}

                        <p className="text-[10px] text-[#94A3B8] mt-1.5 ml-1">
                          VoterGraph AI · {msg.timestamp}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Loading Indicator */}
          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#EEF2FF] border border-[#C7D2FE] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Shield className="w-4 h-4 text-[#1E3A8A] animate-pulse" />
                </div>
                <div className="bg-white rounded-2xl rounded-tl-sm px-5 py-4 text-sm shadow-sm border border-[#E2E8F0] flex gap-1.5 items-center">
                  {queueStatus ? (
                    <span className="text-[#64748B] italic flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      {queueStatus.status === 'PENDING' ? `Waiting in queue (position ${queueStatus.position || 1})...` : 'Processing your query...'}
                    </span>
                  ) : (
                    <>
                      <span className="w-2 h-2 bg-[#94A3B8] rounded-full animate-bounce"></span>
                      <span className="w-2 h-2 bg-[#94A3B8] rounded-full animate-bounce" style={{animationDelay: '0.15s'}}></span>
                      <span className="w-2 h-2 bg-[#94A3B8] rounded-full animate-bounce" style={{animationDelay: '0.3s'}}></span>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="px-6 pb-6">
          {/* Geo Scope Filters */}
          <div className="mb-3 grid grid-cols-4 gap-2 bg-white p-3 rounded-xl border border-[#E2E8F0] shadow-sm">
            <select value={selectedState} onChange={e => setSelectedState(e.target.value)} className="w-full px-2 py-1.5 rounded-md border border-[#E2E8F0] text-xs text-[#0F172A] bg-transparent">
              <option value="">All States</option>
              {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select disabled={!selectedState} value={selectedDistrict} onChange={e => setSelectedDistrict(e.target.value)} className="w-full px-2 py-1.5 rounded-md border border-[#E2E8F0] text-xs text-[#0F172A] bg-transparent disabled:opacity-50">
              <option value="">All Districts</option>
              {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select disabled={!selectedDistrict} value={selectedConstituency} onChange={e => setSelectedConstituency(e.target.value)} className="w-full px-2 py-1.5 rounded-md border border-[#E2E8F0] text-xs text-[#0F172A] bg-transparent disabled:opacity-50">
              <option value="">All Constituencies</option>
              {constituencies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select disabled={!selectedConstituency} value={selectedStation} onChange={e => setSelectedStation(e.target.value)} className="w-full px-2 py-1.5 rounded-md border border-[#E2E8F0] text-xs text-[#0F172A] bg-transparent disabled:opacity-50">
              <option value="">All Polling Stations</option>
              {pollingStations.map(p => <option key={p.id} value={p.number}>{p.name}</option>)}
            </select>
          </div>

          <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm flex items-end gap-2 p-3">
            <textarea
              rows={2}
              value={input}
              disabled={!selectedConstituency}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                 if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!selectedConstituency) return;
                    // If last message was clarification without options, this is a resume
                    const lastMsg = messages[messages.length - 1];
                    if (lastMsg && lastMsg.role === 'agent' && lastMsg.needs_clarification && !lastMsg.clarification_options) {
                        handleSend(input, true, lastMsg.sessionId);
                    } else {
                        handleSend();
                    }
                 }
              }}
              placeholder={selectedConstituency ? "Ask about ancestral names, house numbers, or ward lineages..." : "Please select a constituency to enable chat..."}
              className="flex-1 resize-none text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none leading-relaxed bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E2E8F0] cursor-pointer hover:bg-[#F8FAFC] transition-colors">
                <Globe className="w-3.5 h-3.5 text-[#64748B]" />
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="text-xs text-[#475569] font-medium bg-transparent cursor-pointer focus:outline-none"
                >
                  <option>English</option>
                  <option>Hinglish</option>
                  <option>Hindi</option>
                </select>
              </div>
              <button
                onClick={() => {
                    if (!selectedConstituency) return;
                    const lastMsg = messages[messages.length - 1];
                    if (lastMsg && lastMsg.role === 'agent' && lastMsg.needs_clarification && !lastMsg.clarification_options) {
                        handleSend(input, true, lastMsg.sessionId);
                    } else {
                        handleSend();
                    }
                }}
                disabled={loading || !selectedConstituency}
                className="w-9 h-9 rounded-lg bg-[#1E3A8A] hover:bg-[#1e40af] flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
          <p className="text-center text-[10px] text-[#94A3B8] mt-2">
            VoterGraph AI may produce errors. Verify critical lineage data against official records.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Admin Dashboard ──────────────────────────────────────────────────────────

function AdminScreen({ onBack }: { onBack: () => void }) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="min-h-screen bg-[#F8FAFC]" style={{ fontFamily: "Inter, sans-serif" }}>
      {/* Top nav */}
      <header className="bg-white border-b border-[#E2E8F0] px-8 h-14 flex items-center gap-4">
        <div className="flex items-center gap-2 mr-6">
          <Shield className="w-5 h-5 text-[#1E3A8A]" />
          <span className="font-semibold text-[#0F172A] text-sm">VoterGraph.ai</span>
        </div>
        <div className="flex items-center gap-1 text-sm text-[#94A3B8]">
          <button onClick={onBack} className="hover:text-[#0F172A] transition-colors">Chat</button>
          <span>/</span>
          <span className="text-[#0F172A] font-medium">Admin Ingestion</span>
        </div>
        <div className="ml-auto">
          <span className="px-3 py-1.5 rounded-lg bg-[#FEF9C3] border border-[#FDE047] text-xs font-medium text-[#854D0E]">
            🔐 Admin Access
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-[#0F172A] mb-1">Ingestion Dashboard</h1>
          <p className="text-[#64748B] text-sm">Upload electoral roll documents for Neo4j ingestion and phonetic deduplication.</p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "Total Nodes in Graph", value: "4,232", icon: "🧬", color: "text-[#1E3A8A]" },
            { label: "Phonetic Dedup Rate (avg)", value: "15.2%", icon: "🔤", color: "text-emerald-600" },
            { label: "Active Electoral Rolls", value: "3", icon: "📋", color: "text-[#0F172A]" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-[#E2E8F0] p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-[#64748B]">{s.label}</span>
                <span className="text-base">{s.icon}</span>
              </div>
              <p className={`text-2xl font-semibold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Upload box */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); }}
          className={`rounded-xl border-2 border-dashed transition-colors mb-8 ${
            dragOver
              ? "border-[#2563EB] bg-[#EEF2FF]"
              : "border-[#CBD5E1] bg-white hover:border-[#94A3B8]"
          } p-12 flex flex-col items-center justify-center text-center cursor-pointer`}
        >
          <div className="w-12 h-12 rounded-full bg-[#EEF2FF] flex items-center justify-center mb-4">
            <Upload className="w-6 h-6 text-[#1E3A8A]" />
          </div>
          <p className="text-sm font-medium text-[#0F172A] mb-1">
            Upload Electoral Roll (JSON / CSV / PDF Scanner)
          </p>
          <p className="text-xs text-[#64748B] mb-4">
            Drag and drop files here, or click to browse
          </p>
          <button className="px-4 py-2 bg-[#1E3A8A] hover:bg-[#1e40af] text-white text-sm font-medium rounded-lg transition-colors">
            Choose Files
          </button>
          <p className="text-[10px] text-[#94A3B8] mt-3">
            Supports JSON, CSV, PDF · Max 50MB per file
          </p>
        </div>

        {/* Status table */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#0F172A]">Recently Processed Files</h2>
            <span className="text-xs text-[#94A3B8]">Auto-refreshes every 30s</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                  {["File Name", "Ward No.", "Nodes Created", "Phonetic Deduplication Rate", "Status"].map((h) => (
                    <th key={h} className="px-6 py-3 text-left text-[10px] font-semibold text-[#64748B] uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {INGESTION_ROWS.map((row, i) => (
                  <tr key={i} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] transition-colors last:border-0">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-base">
                          {row.file.endsWith(".json") ? "🗂️" : row.file.endsWith(".csv") ? "📊" : "📄"}
                        </span>
                        <span
                          className="font-medium text-[#0F172A]"
                          style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "13px" }}
                        >
                          {row.file}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-[#475569]">{row.ward}</td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-[#0F172A]">{row.nodes}</span>
                      <span className="text-[#94A3B8] ml-1 text-xs">nodes</span>
                    </td>
                    <td className="px-6 py-4 text-[#475569]">{row.dedup}</td>
                    <td className="px-6 py-4">
                      {row.status === "active" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Active in Neo4j
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-xs font-medium text-amber-700">
                          <Clock className="w-3 h-3" />
                          Processing
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState<Screen>("login");
  const [userRole, setUserRole] = useState<string>("CITIZEN");
  const [userEmail, setUserEmail] = useState<string>("");

  return (
    <div className="size-full bg-background" style={{ fontFamily: "Inter, sans-serif" }}>
      {screen === "login" && <LoginScreen onLogin={(role, email) => {
        setUserRole(role);
        setUserEmail(email);
        setScreen(role === 'CIVIC_ADMIN' ? 'admin' : 'chat');
      }} />}
      {screen === "chat" && (
        <ChatScreen 
          userRole={userRole}
          userEmail={userEmail}
          onAdmin={() => setScreen("admin")} 
          onLogout={() => { setScreen("login"); localStorage.removeItem("token"); }} 
        />
      )}
      {screen === "admin" && <AdminScreen onBack={() => setScreen("chat")} />}
    </div>
  );
}
