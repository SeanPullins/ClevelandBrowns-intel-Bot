import React, { useState, useEffect } from "react";
import { 
  Terminal, 
  Shield, 
  Settings, 
  FolderCheck, 
  RefreshCw, 
  Database, 
  Cpu, 
  Layers, 
  Flame, 
  CheckCircle, 
  AlertTriangle, 
  HelpCircle, 
  TrendingUp, 
  Users, 
  Search,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  Clock,
  Send,
  Sparkles
} from "lucide-react";

// Types
interface IntelItem {
  title: string;
  url: string;
  source_name: string;
  source_type: string;
  source_tier_label?: string;
  credibility_score?: number;
  category: string;
  published: string;
  summary: string;
}

export default function App() {
  // State
  const [selectedHours, setSelectedHours] = useState<number>(72);
  const [skipAi, setSkipAi] = useState<boolean>(false);
  const [activeModel, setActiveModel] = useState<string>("openai/gpt-5.2");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeSection, setActiveSection] = useState<string>("brief");
  
  // Terminal Logs simulation
  const [terminalInput, setTerminalInput] = useState<string>("");
  const [terminalLogs, setTerminalLogs] = useState<Array<{ text: string; type: "input" | "system" | "success" | "warning" | "error" }>>([
    { text: "python browns_intel_bot.py --test-openrouter", type: "input" },
    { text: "[SYSTEM] Connecting to OpenRouter API...", type: "system" },
    { text: "[SYSTEM] Headers verified: X-OpenRouter-Title set.", type: "system" },
    { text: '[SUCCESS] OpenRouter connected: "OpenRouter connected for Browns bot."', type: "success" },
    { text: "python browns_intel_bot.py --hours 72", type: "input" },
    { text: "[PROCESS] Crawling 3 registered channels...", type: "system" },
    { text: "[PROCESS] Processing 3 timeline items into intelligence briefing...", type: "system" },
    { text: "[SUCCESS] Compiled latest.json and generated archive/20260519_235313.json successfully.", type: "success" }
  ]);

  // Is running python simulation state
  const [isCompiling, setIsCompiling] = useState<boolean>(false);

  // Mock Intel Items based on realistic Browns news
  const [allItems, setAllItems] = useState<IntelItem[]>([
    {
      title: "Cleveland Browns Roster Structuring: Quarterback Dynamic Evaluated",
      url: "https://www.clevelandbrowns.com/news/roster-structuring-qb-dynamic",
      source_name: "Official Browns News",
      source_type: "official",
      source_tier_label: "Tier 1",
      credibility_score: 95,
      category: "Roster / Coaching",
      published: "2026-05-19 21:53:00 UTC",
      summary: "Front office confirms standard active reps distribution across the entire QB room. Focus remains on tactical integration during the upcoming phase of training and evaluation."
    },
    {
      title: "Unpacking New Offensive Line Signals from Browns Open Workouts",
      url: "https://dawgpounddaily.com/posts/offensive-line-signals-workouts",
      source_name: "Dawg Pound Daily",
      source_type: "article",
      source_tier_label: "Tier 2",
      credibility_score: 75,
      category: "Roster / Analysis",
      published: "2026-05-19 18:53:00 UTC",
      summary: "Observation indicates offensive coaches are implementing variable pre-snap checks. Reps for younger depth candidates increased today, signaling potential reshuffles."
    },
    {
      title: "Evaluating Pre-Draft Visit Schedules: Browns Eye Defensive Line Prospects",
      url: "https://www.brownsnation.com/evaluating-visit-schedules-defensive-line",
      source_name: "Browns Nation",
      source_type: "article",
      source_tier_label: "Tier 2",
      credibility_score: 70,
      category: "General News",
      published: "2026-05-19 13:53:00 UTC",
      summary: "Scouting network logs suggest visiting lists highlight premium prospects on the edge. Analysts discuss betting market shifts matching defensive draft positions."
    },
    {
      title: "Ken Dorsey's Passing Game Influence: What YouTube Tapes Signal",
      url: "https://www.youtube.com/watch?v=browns-dorsey-concept",
      source_name: "OBR Film Breakdown",
      source_type: "youtube",
      source_tier_label: "Tier 3",
      credibility_score: 85,
      category: "Coaching Logic",
      published: "2026-05-18 22:15:00 UTC",
      summary: "Deep-dive video breakdown mapping offensive shifts. The coaching staff is hinting at more 11-personnel spreads to stretch boundaries and evaluate decision times."
    }
  ]);

  // Handle running simulation commands
  const runBotCommand = (cmd: string) => {
    if (!cmd.trim()) return;
    const cleanCmd = cmd.trim();
    setTerminalLogs(prev => [...prev, { text: cleanCmd, type: "input" }]);
    setTerminalInput("");
    setIsCompiling(true);

    setTimeout(() => {
      if (cleanCmd.includes("--help")) {
        setTerminalLogs(prev => [
          ...prev,
          { text: "usage: browns_intel_bot.py [-h] [--hours HOURS] [--skip-ai] [--test-openrouter] [--memory-stats]", type: "system" },
          { text: "options:", type: "system" },
          { text: "  -h, --help            show this help message and exit", type: "system" },
          { text: "  --hours HOURS         Hours of timeline history to aggregate", type: "system" },
          { text: "  --skip-ai             Do not call OpenRouter, use fallback brief", type: "system" },
          { text: "  --test-openrouter     Send a small connection test to OpenRouter and exit", type: "system" },
          { text: "  --memory-stats        Print simple memory/source stats info and exit", type: "system" }
        ]);
      } else if (cleanCmd.includes("--test-openrouter")) {
        setTerminalLogs(prev => [
          ...prev,
          { text: "[SYSTEM] Connecting to OpenRouter API completions endpoint...", type: "system" },
          { text: `[SYSTEM] Using model configured model: ${activeModel}`, type: "system" },
          { text: '[SUCCESS] Connection Succeeded! Received answer: "OpenRouter connected for Browns bot."', type: "success" }
        ]);
      } else if (cleanCmd.includes("--memory-stats")) {
        setTerminalLogs(prev => [
          ...prev,
          { text: "=== Memory / Source Database Stats ===", type: "system" },
          { text: "Active crawling channels: 4 feeds", type: "success" },
          { text: "Total in-memory indexed records: 58 sources tracked inside volatile tracker", type: "success" }
        ]);
      } else if (cleanCmd.includes("python browns_intel_bot.py")) {
        const hrsMatch = cleanCmd.match(/--hours\s+(\d+)/);
        const hoursVal = hrsMatch ? parseInt(hrsMatch[1]) : selectedHours;
        const skip = cleanCmd.includes("--skip-ai") || skipAi;
        
        setTerminalLogs(prev => [
          ...prev,
          { text: `[START] Running Intel bot for trailing ${hoursVal} hours...`, type: "system" },
          { text: `[INFO] Harvested ${allItems.length} events from database.`, type: "system" }
        ]);

        setTimeout(() => {
          if (skip) {
            setTerminalLogs(prev => [
              ...prev,
              { text: "[SKIPPED] AI Brief requested skip (--skip-ai). Speed-rendering static fallback brief.", type: "warning" },
              { text: "[SUCCESS] Executed correctly. Output written downstream to docs/latest.json.", type: "success" }
            ]);
          } else {
            setTerminalLogs(prev => [
              ...prev,
              { text: `[API] Conveying context elements to OpenRouter using ${activeModel}...`, type: "system" },
              { text: "[SUCCESS] Received high value report summary. Output compiled safely.", type: "success" }
            ]);
          }
        }, 800);
      } else {
        setTerminalLogs(prev => [
          ...prev,
          { text: `Unknown command: '${cleanCmd}'. Try adding '--help' or running 'python browns_intel_bot.py --test-openrouter'`, type: "error" }
        ]);
      }
      setIsCompiling(false);
    }, 600);
  };

  // Run initial synthesis trigger to look alive
  useEffect(() => {
    // Keep it responsive
  }, []);

  const filteredItems = allItems.filter(item => {
    const query = searchQuery.toLowerCase();
    return (
      item.title.toLowerCase().includes(query) ||
      item.source_name.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query) ||
      item.summary.toLowerCase().includes(query)
    );
  });

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-stone-200 flex flex-col font-sans">
      
      {/* HEADER BAR */}
      <header className="h-16 border-b border-stone-800 bg-[#121212] flex items-center justify-between px-6 md:px-8 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-9 h-9 bg-[#FF3C00] rounded flex items-center justify-center shadow-[0_0_15px_rgba(255,60,0,0.5)] transform rotate-3">
            <span className="font-sans font-black text-black text-xl italic tracking-tight">B</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm md:text-base font-bold tracking-tight uppercase text-white">
                Browns Intelligence <span className="text-[#FF3C00]">Command</span>
              </h1>
              <span className="text-[9px] font-mono px-1.5 py-0.5 bg-stone-800 text-stone-400 rounded border border-stone-700">v2.1</span>
            </div>
            <p className="text-[10px] text-stone-500 font-mono">SEAN'S CLEVELAND ANALYTIC ENGINE</p>
          </div>
        </div>

        {/* Status indicator pill & Config summaries */}
        <div className="flex items-center gap-6">
          <div className="hidden sm:flex items-center gap-2.5 bg-[#181818] px-3.5 py-1.5 rounded border border-stone-800">
            <div className="w-2.5 h-2.5 rounded-full bg-[#00FF00] animate-pulse shadow-[0_0_8px_rgba(0,255,0,0.7)]"></div>
            <span className="text-[10px] font-mono text-stone-300 uppercase tracking-widest font-semibold">OpenRouter: Operational</span>
          </div>

          <div className="h-8 w-px bg-stone-800 hidden md:block"></div>

          <div className="text-right hidden sm:block">
            <p className="text-[9px] uppercase text-stone-500 font-bold tracking-wider">Active Analysis Target</p>
            <p className="text-xs font-mono text-[#FF3C00]">{activeModel}</p>
          </div>
        </div>
      </header>

      {/* CORE CONTROL HUB */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-px bg-stone-800 overflow-hidden">
        
        {/* LEFT COLUMN: CRITICAL INTELLIGENCE & REPORT PREVIEW (cols=7) */}
        <section className="lg:col-span-7 bg-[#0f0f0f] flex flex-col overflow-y-auto">
          
          {/* Header of analysis tool */}
          <div className="p-4 md:p-6 border-b border-stone-800 bg-[#141414] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-stone-400 flex items-center gap-2">
                <Sparkles className="w-4.5 h-4.5 text-[#FF3C00]" />
                Latest Generated Intelligence Briefing
              </h2>
              <p className="text-[11px] text-stone-500 font-mono mt-1">Compiled from verified team assets & digital crawls</p>
            </div>
            
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <span className="text-[10px] font-mono bg-[#FF3C00]/10 text-[#FF3C00] px-2.5 py-1 rounded border border-[#FF3C00]/20 font-semibold tracking-wider">
                STATUS: {skipAi ? "HEURISTIC FALLBACK (SKIPPED)" : "SYNTHESIZED"}
              </span>
            </div>
          </div>

          {/* Prompt Controls & Configuration Header */}
          <div className="p-4 bg-[#111111] border-b border-stone-900 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] uppercase font-mono text-stone-500 mb-1">Trailing Timeline</label>
              <select 
                value={selectedHours} 
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  setSelectedHours(val);
                  setTerminalLogs(prev => [...prev, { text: `[CONFIG] Timeline bounds shifted to ${val} hours.`, type: "system" }]);
                }}
                className="w-full text-xs font-mono bg-stone-900 border border-stone-800 rounded px-2.5 py-1.5 text-stone-300 focus:outline-none focus:border-[#FF3C00]"
              >
                <option value={12}>12 Hours (Current)</option>
                <option value={24}>24 Hours (Recent)</option>
                <option value={72}>72 Hours (Default Weekend)</option>
                <option value={168}>168 Hours (Full Week)</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] uppercase font-mono text-stone-500 mb-1">OpenRouter Engine</label>
              <select 
                value={activeModel} 
                onChange={(e) => {
                  setActiveModel(e.target.value);
                  setTerminalLogs(prev => [...prev, { text: `[CONFIG] OpenRouter model altered to ${e.target.value}`, type: "system" }]);
                }}
                className="w-full text-xs font-mono bg-stone-900 border border-stone-800 rounded px-2.5 py-1.5 text-[#FF3C00] focus:outline-none focus:border-[#FF3C00]"
              >
                <option value="openai/gpt-5.2">openai/gpt-5.2 (Default)</option>
                <option value="meta-llama/llama-3.3-70b-instruct">meta-llama/llama-3.3-70b</option>
                <option value="google/gemini-2.5-pro">google/gemini-2.5-pro</option>
                <option value="anthropic/claude-3.7-sonnet">claude-3.7-sonnet</option>
              </select>
            </div>

            <div className="flex flex-col justify-end">
              <button
                onClick={() => {
                  setSkipAi(prev => !prev);
                  setTerminalLogs(prev => [...prev, { text: `[TOGGLE] AI skip feature state set to ${!skipAi}`, type: "system" }]);
                }}
                className={`w-full text-left text-xs font-mono border rounded px-3 py-1.5 transition-all flex items-center justify-between ${
                  skipAi 
                    ? "bg-[#FF3C00]/10 border-[#FF3C00]/40 text-[#FF3C00]" 
                    : "bg-stone-900 border-stone-800 text-stone-400 hover:border-stone-700"
                }`}
              >
                <span>--skip-ai flag status</span>
                <span className="font-bold underline text-[10px]">{skipAi ? "ACTIVE" : "DISABLED"}</span>
              </button>
            </div>
          </div>

          {/* INTEL REPORT VISUALS */}
          <div className="flex-1 p-6 md:p-8 space-y-8 bg-gradient-to-b from-transparent to-[#0a0a0a]">
            
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-[#FF3C00]/30 pb-2">
                <span className="text-[#FF3C00] font-mono font-bold text-lg">#</span>
                <h3 className="text-xl md:text-2xl font-serif italic text-white">Executive Brief</h3>
              </div>
              <p className="text-stone-300 text-sm leading-relaxed font-sans">
                Source scans confirm strategic reps and rotation limits across defense edges. Roster volatility centered on the offensive line and secondary continues to dominate the technical landscape. Intelligence suggests a 15% increase in veteran trade speculation <span className="text-[#FF3C00] font-mono text-xs font-bold">[1]</span>. The front office appears to be signaling a long-term commitment to current QB rotation configurations while maintaining high draft liquidity prior to deep scouting seasons <span className="text-[#FF3C00] font-mono text-xs font-bold">[2, 3]</span>.
              </p>
            </div>

            {/* Signals side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-[#121212] border border-stone-800 rounded-lg shadow-sm">
                <div className="flex items-center justify-between mb-3 border-b border-stone-800 pb-2">
                  <h4 className="text-[#00FF00] text-xs font-bold font-mono uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00FF00]"></span>
                    Strong Signals
                  </h4>
                  <span className="text-[9px] font-mono text-stone-500">VERIFIED STATUS</span>
                </div>
                <ul className="text-xs space-y-2.5 text-stone-400 font-mono">
                  <li className="flex items-start gap-2">
                    <span className="text-stone-600 font-bold">&gt;</span>
                    <span>Wills Practice Reps Attendance is confirmed <span className="text-[#FF3C00] font-bold">[1]</span></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-stone-600 font-bold">&gt;</span>
                    <span>Pre-draft visiting schedules prioritized edges <span className="text-[#FF3C00] font-bold">[3]</span></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-stone-600 font-bold">&gt;</span>
                    <span>Salary cap restructuring target threshold met <span className="text-[#FF3C00] font-bold">[2]</span></span>
                  </li>
                </ul>
              </div>

              <div className="p-4 bg-[#121212] border border-stone-800 rounded-lg shadow-sm">
                <div className="flex items-center justify-between mb-3 border-b border-stone-800 pb-2">
                  <h4 className="text-stone-400 text-xs font-bold font-mono uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-stone-500"></span>
                    Developing / Uncertain
                  </h4>
                  <span className="text-[9px] font-mono text-stone-500 font-semibold">HEURISTIC LEVEL</span>
                </div>
                <ul className="text-xs space-y-2.5 text-stone-500 font-mono italic">
                  <li className="flex items-start gap-2">
                    <span className="text-stone-700 font-bold">?</span>
                    <span>Locker Room configuration speculation <span className="text-stone-600 font-bold">[2]</span></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-stone-700 font-bold">?</span>
                    <span>Tactical variables on Dorsey spread plays <span className="text-stone-600 font-bold">[4]</span></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-stone-700 font-bold">?</span>
                    <span>Pre-camp fitness rehabilitation metrics status <span className="text-stone-600 font-bold">[1]</span></span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Deep dive sections */}
            <div className="space-y-6">
              
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-stone-800 pb-1.5">
                  <span className="text-[#FF3C00] font-mono font-bold">#</span>
                  <h3 className="text-base font-bold text-white uppercase tracking-tight">QB Room Movement</h3>
                </div>
                <div className="p-4 border-l-2 border-[#FF3C00] bg-stone-900/40 rounded-r">
                  <p className="text-sm text-stone-300 leading-relaxed italic">
                    "Front office confirms active reps rotation inside our quarterback room configuration. No signs of trade readiness exist at this juncture target timeline." <span className="text-stone-500 font-mono text-xs">[Source: Official team post 01]</span>
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-stone-800 pb-1.5">
                  <span className="text-[#FF3C00] font-mono font-bold">#</span>
                  <h3 className="text-base font-bold text-white uppercase tracking-tight">Roster / Injury Movement</h3>
                </div>
                <p className="text-stone-400 text-sm leading-relaxed">
                  Offensive linemen observations indicate slow but consistent recovery. Rep distribution during training visits focuses on preserving endurance indices <span className="text-[#FF3C00] font-mono text-xs font-bold">[2]</span>.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-stone-800 pb-1.5">
                  <span className="text-[#FF3C00] font-mono font-bold">#</span>
                  <h3 className="text-base font-bold text-white uppercase tracking-tight">Draft Intel & Front Office</h3>
                </div>
                <p className="text-stone-400 text-sm leading-relaxed">
                  Scouts and representatives are heavily aligned with edge rusher visits. Heavy consensus builds around defensive prioritizations starting inside early selection windows <span className="text-[#FF3C00] font-mono text-xs font-bold">[3]</span>.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-stone-800 pb-1.5">
                  <span className="text-[#FF3C00] font-mono font-bold">#</span>
                  <h3 className="text-base font-bold text-white uppercase tracking-tight">Watch List & Questions</h3>
                </div>
                <div className="p-3 bg-[#131313] rounded border border-stone-800">
                  <ul className="text-xs space-y-2 text-stone-300 font-mono">
                    <li className="flex items-center gap-2 text-stone-400">
                      <span className="w-1.5 h-1.5 bg-[#FF3C00] rounded-full"></span>
                      <span>How will the Dorsey spacing system alter the redzone approach?</span>
                    </li>
                    <li className="flex items-center gap-2 text-stone-400">
                      <span className="w-1.5 h-1.5 bg-[#FF3C00] rounded-full"></span>
                      <span>Will pre-draft visits lead to draft day maneuvers on the line?</span>
                    </li>
                  </ul>
                </div>
              </div>

            </div>

          </div>
        </section>

        {/* RIGHT COLUMN: CORE SYSTEMS & LOG CONTROLS (cols=5) */}
        <section className="lg:col-span-5 bg-[#121212] flex flex-col overflow-hidden border-t lg:border-t-0 lg:border-l border-stone-800">
          
          {/* ENVIRONMENT STATUS CHECKLIST */}
          <div className="p-4 md:p-6 border-b border-stone-800 bg-[#161616]">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#FF3C00] mb-3.5 flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" />
              Runtime Config & Security
            </h2>
            
            <div className="space-y-2.5">
              <div className="flex justify-between items-center text-[11px] bg-stone-900 px-3 py-2 rounded border border-stone-800">
                <span className="font-mono text-stone-400">OPENROUTER_API_KEY</span>
                <span className="text-emerald-400 font-mono font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  SECURE_LOADED
                </span>
              </div>

              <div className="flex justify-between items-center text-[11px] bg-stone-900 px-3 py-2 rounded border border-stone-800">
                <span className="font-mono text-stone-400">OPENROUTER_MODEL</span>
                <span className="font-mono text-stone-300">{activeModel}</span>
              </div>

              <div className="flex justify-between items-center text-[11px] bg-stone-900 px-3 py-2 rounded border border-stone-800">
                <span className="font-mono text-stone-400">.gitignore Protection</span>
                <span className="text-emerald-400 font-mono font-bold flex items-center gap-1 text-[10px] uppercase">
                  ACTIVE (.env protected)
                </span>
              </div>
            </div>
          </div>

          {/* HARVESTOR SOURCES SEARCH & PULSE */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-[250px] lg:min-h-0">
            
            <div className="px-5 py-3.5 bg-[#191919] border-b border-stone-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest flex items-center gap-1.5">
                <Database className="w-4 h-4 text-cyan-400" />
                Aggregated Intel Sources
              </span>
              <span className="text-[10px] font-mono text-stone-500 font-bold">{filteredItems.length} ITEMS DETECTED</span>
            </div>

            {/* Source search bar */}
            <div className="p-3 bg-stone-900/60 border-b border-stone-800 flex items-center gap-2 shrink-0">
              <Search className="w-4 h-4 text-stone-500 ml-1.5" />
              <input 
                type="text" 
                placeholder="Search raw pipeline items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border-none text-xs text-stone-300 w-full focus:outline-none placeholder-stone-600 font-mono"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="text-[10px] text-[#FF3C00] font-mono px-1.5 hover:underline">
                  CLEAR
                </button>
              )}
            </div>

            {/* List of harvested timeline items */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#111111]/80">
              {filteredItems.map((item, idx) => (
                <div 
                  key={idx}
                  className="p-3.5 bg-[#161616] border border-stone-800 hover:border-stone-700 rounded-lg transition-all group duration-200"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] font-mono font-black uppercase px-2 py-0.5 rounded-sm ${
                        item.source_type === "official" 
                          ? "bg-amber-900/40 text-[#FF3C00] border border-[#FF3C00]/20" 
                          : item.source_type === "youtube"
                          ? "bg-red-950/40 text-red-400 border border-red-900/30"
                          : "bg-blue-950/40 text-blue-400 border border-blue-900/30"
                      }`}>
                        {item.source_name}
                      </span>
                      {item.source_tier_label && (
                        <span className="text-[8px] font-mono bg-stone-800 text-stone-400 px-1 py-0.2 rounded">
                          {item.source_tier_label}
                        </span>
                      )}
                    </div>
                    <span className="text-[9px] font-mono text-stone-500">{item.published}</span>
                  </div>

                  <h5 className="text-xs font-semibold text-white group-hover:text-[#FF3C00] transition-colors leading-snug">
                    {item.title}
                  </h5>
                  
                  <p className="text-[11px] text-stone-400 mt-2 leading-relaxed">
                    {item.summary}
                  </p>

                  <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-stone-500 border-t border-stone-800/40 pt-2 shrink-0">
                    <span>Category: <strong className="text-stone-400">{item.category}</strong></span>
                    {item.credibility_score && (
                      <span className="text-emerald-500 font-semibold">Credibility: {item.credibility_score}%</span>
                    )}
                  </div>
                </div>
              ))}

              {filteredItems.length === 0 && (
                <div className="text-center py-8">
                  <AlertTriangle className="w-8 h-8 text-stone-600 mx-auto mb-2" />
                  <p className="text-xs text-stone-500 font-mono">No items match the pipeline query.</p>
                </div>
              )}
            </div>
          </div>

          {/* INTERACTIVE CLI TERMINAL SIMULATOR */}
          <div className="h-60 bg-[#000] border-t border-stone-800 flex flex-col overflow-hidden shrink-0">
            
            {/* Terminal bar header */}
            <div className="flex items-center justify-between px-4 py-2 bg-[#090909] border-b border-stone-800 font-mono text-[10px] text-stone-500 shrink-0">
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-white font-bold leading-none">browns_intel_bot@terminal</span>
              </div>
              <div className="flex items-center gap-3">
                <span>1024x768</span>
                <button 
                  onClick={() => setTerminalLogs([])}
                  className="hover:text-white transition-colors underline decoration-dotted"
                >
                  Clear Terminal
                </button>
              </div>
            </div>

            {/* Terminal output display */}
            <div className="flex-1 p-4 font-mono text-[11px] overflow-y-auto space-y-1.5 scrollbar-thin">
              {terminalLogs.map((log, index) => {
                if (log.type === "input") {
                  return (
                    <div key={index} className="text-emerald-500">
                      $ <span className="text-white font-bold">{log.text}</span>
                    </div>
                  );
                } else if (log.type === "success") {
                  return (
                    <div key={index} className="text-emerald-400 bg-emerald-950/20 px-1 py-0.5 rounded italic">
                      {log.text}
                    </div>
                  );
                } else if (log.type === "warning") {
                  return (
                    <div key={index} className="text-[#FF3C00] bg-amber-950/15 px-1 py-0.5 rounded">
                      {log.text}
                    </div>
                  );
                } else if (log.type === "error") {
                  return (
                    <div key={index} className="text-red-400 bg-red-950/20 px-1 py-0.5 rounded">
                      {log.text}
                    </div>
                  );
                } else {
                  return (
                    <div key={index} className="text-stone-400">
                      {log.text}
                    </div>
                  );
                }
              })}
              {isCompiling && (
                <div className="text-stone-500 animate-pulse font-bold">
                  [PROCESS] Simulating execution query ...
                </div>
              )}
            </div>

            {/* Quick terminal quick buttons suggestions */}
            <div className="px-3 py-1.5 bg-stone-950 border-t border-stone-900 flex gap-2 overflow-x-auto whitespace-nowrap shrink-0">
              <button 
                onClick={() => runBotCommand("python browns_intel_bot.py --test-openrouter")}
                className="text-[10px] font-mono bg-stone-900 border border-stone-800 text-stone-400 hover:text-white hover:border-[#FF3C00] px-2.5 py-1 rounded"
              >
                Run Connection Test
              </button>
              <button 
                onClick={() => runBotCommand(`python browns_intel_bot.py --hours ${selectedHours}`)}
                className="text-[10px] font-mono bg-stone-900 border border-stone-800 text-stone-400 hover:text-white hover:border-[#FF3C00] px-2.5 py-1 rounded"
              >
                Compile Report (Current Hours)
              </button>
              <button 
                onClick={() => runBotCommand("python browns_intel_bot.py --memory-stats")}
                className="text-[10px] font-mono bg-stone-900 border border-stone-800 text-stone-400 hover:text-white hover:border-[#FF3C00] px-2.5 py-1 rounded"
              >
                Inmemory Stats
              </button>
              <button 
                onClick={() => runBotCommand("python browns_intel_bot.py --help")}
                className="text-[10px] font-mono bg-stone-900 border border-stone-800 text-stone-400 hover:text-white hover:border-stone-600 px-2.5 py-1 rounded"
              >
                Help Manual
              </button>
            </div>

            {/* Terminal Command Input */}
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                runBotCommand(terminalInput);
              }}
              className="flex items-center bg-[#050505] border-t border-stone-900 px-3 py-2 shrink-0"
            >
              <span className="text-emerald-500 font-mono text-xs font-bold mr-2 shrink-0">$</span>
              <input 
                type="text"
                placeholder="Type command (e.g., python browns_intel_bot.py --hours 24) or pick above..."
                value={terminalInput}
                onChange={(e) => setTerminalInput(e.target.value)}
                className="bg-transparent border-none text-xs text-white uppercase font-mono w-full focus:outline-none placeholder-stone-700"
              />
              <button 
                type="submit" 
                className="text-stone-500 hover:text-white p-1"
                title="Send Command"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>

          </div>
        </section>

      </div>

      {/* FOOTER SYSTEM METRICS BAR */}
      <footer className="h-10 bg-[#090909] border-t border-stone-800 flex items-center justify-between px-6 text-[10px] font-mono tracking-wider text-stone-500 shrink-0">
        <div className="flex gap-4">
          <span className="flex items-center gap-1">
            <Shield className="w-3.5 h-3.5 text-[#FF3C00]" />
            SESSION: <strong className="text-stone-400">88A922C</strong>
          </span>
          <span className="hidden sm:inline">FLAGS: <strong className="text-stone-400">--test-openrouter --skip-ai --memory-stats</strong></span>
        </div>
        
        <div className="flex gap-4">
          <span>CPU: <strong className="text-[#FF3C00]">12%</strong></span>
          <span>MEM: <strong className="text-[#FF3C00]">242MB</strong></span>
          <span className="hidden sm:inline">UPTIME: <strong className="text-stone-400">14:02:11</strong></span>
        </div>
      </footer>

    </div>
  );
}
