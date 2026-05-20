import React, { useEffect, useMemo, useState } from "react";

type IntelItem = {
  id?: string;
  title: string;
  url: string;
  source_name?: string;
  source_type?: string;
  source_tier_label?: string;
  credibility_score?: number;
  category?: string;
  published?: string;
  summary?: string;
  score?: number;
  is_new?: boolean;
  domain?: string;
};

type Report = {
  generated_at?: string;
  hours?: number;
  ai_provider?: string;
  ai_provider_status?: string;
  ai_model?: string;
  ai_brief?: string;
  items?: IntelItem[];
};

type SortMode = "signal" | "newest" | "credibility";

export default function App() {
  const [report, setReport] = useState<Report | null>(null);
  const [items, setItems] = useState<IntelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [sortMode, setSortMode] = useState<SortMode>("signal");
  const [showFullBrief, setShowFullBrief] = useState(false);
  const [nightMode, setNightMode] = useState(false);

  async function loadReport() {
    setLoading(true);
    setError(null);

    try {
      const dataUrl = `${import.meta.env.BASE_URL}latest.json?ts=${Date.now()}`;
      const res = await fetch(dataUrl, { cache: "no-store" });

      if (!res.ok) throw new Error(`Could not load latest.json. HTTP ${res.status}`);

      const data = await res.json();
      setReport(data);
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err: any) {
      setError(err?.message || "Could not load latest.json");
      setReport(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
  }, []);

  const t = theme(nightMode);

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => set.add(item.category || "General Browns"));
    return ["All", ...Array.from(set).sort()];
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = query.toLowerCase().trim();

    const rows = items.filter((item) => {
      const itemCategory = item.category || "General Browns";
      const matchesCategory = category === "All" || itemCategory === category;

      const haystack = [
        item.title,
        item.summary,
        item.source_name,
        item.domain,
        item.category,
        item.source_tier_label,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return matchesCategory && (!q || haystack.includes(q));
    });

    return [...rows].sort((a, b) => {
      if (sortMode === "newest") return dateMs(b.published) - dateMs(a.published);
      if (sortMode === "credibility") return (b.credibility_score || 0) - (a.credibility_score || 0);
      return (b.score || 0) - (a.score || 0);
    });
  }, [items, query, category, sortMode]);

  const executiveSummary = useMemo(() => {
    return (
      extractSection(report?.ai_brief || "", "Executive Brief") ||
      cleanAIText(report?.ai_brief || "").slice(0, 1200)
    );
  }, [report?.ai_brief]);

  const quickBullets = useMemo(() => {
    return executiveSummary
      .split(/\n+/)
      .map((x) => cleanAIText(x).trim())
      .filter(Boolean)
      .slice(0, 5);
  }, [executiveSummary]);

  const topItems = useMemo(() => {
    return [...items].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
  }, [items]);

  return (
    <main className={`min-h-screen transition-colors duration-300 ${t.page}`}>
      <div className="mx-auto max-w-5xl px-3 py-4 md:px-6 md:py-8">
        <header className={`rounded-3xl border p-4 shadow-xl md:p-7 ${t.hero}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={`text-[11px] font-black uppercase tracking-[0.22em] ${t.eyebrow}`}>
                Browns Intelligence
              </p>

              <h1 className={`mt-2 text-3xl font-black tracking-[-0.05em] md:text-5xl ${t.heading}`}>
                Daily Brief
              </h1>

              <p className={`mt-2 text-sm leading-6 md:text-base ${t.muted}`}>
                AI summary and links from the latest Browns stories.
              </p>
            </div>

            <div className="flex shrink-0 flex-col gap-2">
              <button
                onClick={() => setNightMode((v) => !v)}
                className={t.modeButton}
              >
                {nightMode ? "Day Mode" : "Night Mode"}
              </button>

              <button
                onClick={loadReport}
                className="rounded-2xl bg-orange-600 px-4 py-2 text-sm font-black text-white hover:bg-orange-500"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Updated" value={formatDate(report?.generated_at)} t={t} />
            <Stat label="Stories" value={String(items.length)} t={t} />
            <Stat label="New" value={String(items.filter((x) => x.is_new).length)} t={t} />
            <Stat label="AI" value={statusLabel(report?.ai_provider_status)} t={t} />
          </div>
        </header>

        {loading && <SimplePanel t={t}>Loading latest Browns report…</SimplePanel>}

        {error && (
          <SimplePanel t={t} className="border-red-500/50 bg-red-100/70 text-red-950">
            <h2 className="text-xl font-black">Could not load report</h2>
            <p className="mt-2 text-sm">{error}</p>
          </SimplePanel>
        )}

        {!loading && !error && (
          <>
            <section className={`mt-4 rounded-3xl border p-4 shadow-xl md:p-6 ${t.panel}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={`text-[11px] font-black uppercase tracking-[0.22em] ${t.eyebrow}`}>
                    AI Summary
                  </p>

                  <h2 className={`mt-1 text-2xl font-black tracking-tight ${t.heading}`}>
                    What matters
                  </h2>
                </div>

                <span className={t.badge}>
                  {report?.ai_model ? "AI" : "No AI"}
                </span>
              </div>

              {quickBullets.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {quickBullets.map((line, index) => (
                    <p key={index} className={`rounded-2xl border p-3 text-sm leading-6 ${t.summaryBubble}`}>
                      {line}
                    </p>
                  ))}
                </div>
              ) : (
                <p className={`mt-4 text-sm ${t.muted}`}>
                  No AI summary available yet.
                </p>
              )}

              {report?.ai_brief && (
                <div className="mt-4">
                  <button
                    onClick={() => setShowFullBrief((v) => !v)}
                    className={t.secondaryButton}
                  >
                    {showFullBrief ? "Hide details" : "More AI detail"}
                  </button>

                  {showFullBrief && (
                    <div className={`mt-4 rounded-2xl border p-4 ${t.detailBox}`}>
                      <ReadableText text={cleanAIText(report.ai_brief)} t={t} />
                    </div>
                  )}
                </div>
              )}
            </section>

            {topItems.length > 0 && (
              <section className={`mt-4 rounded-3xl border p-4 md:p-5 ${t.panel}`}>
                <h2 className={`text-lg font-black ${t.heading}`}>Top links</h2>

                <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
                  {topItems.map((item, index) => (
                    <a
                      key={item.id || item.url || index}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className={t.topLinkCard}
                    >
                      <p className="line-clamp-3 text-sm font-black leading-6 text-orange-600">
                        {item.title}
                      </p>
                      <p className={`mt-2 text-xs ${t.muted}`}>
                        {item.source_name || "Unknown source"}
                      </p>
                    </a>
                  ))}
                </div>
              </section>
            )}

            <section className={`sticky top-0 z-20 mt-4 rounded-3xl border p-3 backdrop-blur md:static md:p-5 ${t.filterBar}`}>
              <div className="grid gap-2 md:grid-cols-[1.4fr_0.8fr_0.8fr]">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search stories…"
                  className={t.input}
                />

                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={t.input}
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>

                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className={t.input}
                >
                  <option value="signal">Top signal</option>
                  <option value="newest">Newest</option>
                  <option value="credibility">Most credible</option>
                </select>
              </div>
            </section>

            <section className={`mt-4 rounded-3xl border p-4 md:p-6 ${t.panel}`}>
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className={`text-[11px] font-black uppercase tracking-[0.22em] ${t.eyebrow}`}>
                    Stories
                  </p>

                  <h2 className={`mt-1 text-2xl font-black ${t.heading}`}>
                    Found links
                  </h2>
                </div>

                <p className={`text-sm font-bold ${t.muted}`}>
                  {filteredItems.length}/{items.length}
                </p>
              </div>

              {items.length === 0 && (
                <EmptyState
                  title="No real Browns stories collected"
                  body="The bot did not find real source items in the latest run."
                  t={t}
                />
              )}

              <div className={`mt-4 divide-y ${t.divider}`}>
                {filteredItems.map((item, index) => (
                  <StoryCompact key={item.id || item.url || index} item={item} t={t} />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function StoryCompact({ item, t }: { item: IntelItem; t: ReturnType<typeof theme> }) {
  return (
    <article className="py-4">
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge t={t}>{item.category || "General Browns"}</Badge>
            {item.is_new && <Badge t={t} tone="green">New</Badge>}
          </div>

          <h3 className={`text-base font-black leading-6 md:text-lg ${t.heading}`}>
            <a href={item.url} target="_blank" rel="noreferrer" className="text-orange-600 hover:text-orange-500">
              {item.title}
            </a>
          </h3>

          <p className={`mt-1 text-xs ${t.muted}`}>
            {item.source_name || "Unknown source"} · {formatDate(item.published)}
          </p>

          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-bold text-orange-600">
              Summary
            </summary>
            <p className={`mt-2 text-sm leading-6 ${t.body}`}>
              {cleanAIText(item.summary || "No summary available.")}
            </p>
          </details>
        </div>

        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="h-fit shrink-0 rounded-xl bg-orange-600 px-3 py-2 text-xs font-black text-white hover:bg-orange-500"
        >
          Open
        </a>
      </div>
    </article>
  );
}

function Stat({ label, value, t }: { label: string; value: string; t: ReturnType<typeof theme> }) {
  return (
    <div className={t.stat}>
      <p className={`text-[10px] font-black uppercase tracking-widest ${t.statLabel}`}>{label}</p>
      <p className={`mt-1 truncate text-sm font-black ${t.heading}`}>{value}</p>
    </div>
  );
}

function SimplePanel({
  children,
  className = "",
  t,
}: {
  children: React.ReactNode;
  className?: string;
  t: ReturnType<typeof theme>;
}) {
  return (
    <section className={`mt-4 rounded-3xl border p-5 ${t.panel} ${className}`}>
      {children}
    </section>
  );
}

function Badge({
  children,
  tone = "zinc",
  t,
}: {
  children: React.ReactNode;
  tone?: "zinc" | "green";
  t: ReturnType<typeof theme>;
}) {
  const classes =
    tone === "green"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
      : t.badge;

  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${classes}`}>{children}</span>;
}

function EmptyState({
  title,
  body,
  t,
}: {
  title: string;
  body: string;
  t: ReturnType<typeof theme>;
}) {
  return (
    <div className={`mt-4 rounded-2xl border border-dashed p-6 text-center ${t.empty}`}>
      <h3 className={`text-lg font-black ${t.heading}`}>{title}</h3>
      <p className={`mt-2 text-sm leading-6 ${t.muted}`}>{body}</p>
    </div>
  );
}

function ReadableText({ text, t }: { text: string; t: ReturnType<typeof theme> }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className={`space-y-3 text-sm leading-7 ${t.body}`}>
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}

function theme(night: boolean) {
  if (night) {
    return {
      page: "bg-[#24140d] text-white",
      hero: "border-white/15 bg-[#321d12] text-white",
      panel: "border-white/15 bg-[#321d12] text-white",
      filterBar: "border-white/15 bg-[#321d12]/95 text-white",
      heading: "text-white",
      body: "text-orange-50",
      muted: "text-orange-100/70",
      eyebrow: "text-orange-300",
      divider: "divide-white/15",
      stat: "rounded-2xl border border-white/15 bg-white/10 p-3",
      statLabel: "text-orange-100/60",
      badge: "border-white/20 bg-white/10 text-white",
      empty: "border-white/20 bg-white/10",
      input:
        "rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white outline-none placeholder:text-orange-100/50 focus:border-orange-400",
      modeButton:
        "rounded-2xl border border-white/25 bg-white px-4 py-2 text-sm font-black text-[#321d12] hover:bg-orange-100",
      secondaryButton:
        "rounded-2xl border border-white/20 px-4 py-2 text-sm font-bold text-white hover:bg-white/10",
      summaryBubble: "border-white/15 bg-white/10 text-orange-50",
      detailBox: "border-white/15 bg-white/10",
      topLinkCard:
        "min-w-[260px] rounded-2xl border border-white/15 bg-white/10 p-4 hover:border-orange-300",
    };
  }

  return {
    page: "bg-[#fbf8f4] text-[#2b170f]",
    hero: "border-orange-900/15 bg-white text-[#2b170f]",
    panel: "border-orange-900/15 bg-white text-[#2b170f]",
    filterBar: "border-orange-900/15 bg-white/95 text-[#2b170f]",
    heading: "text-[#2b170f]",
    body: "text-[#3b261b]",
    muted: "text-[#6f5a4d]",
    eyebrow: "text-orange-700",
    divider: "divide-orange-900/10",
    stat: "rounded-2xl border border-orange-900/10 bg-[#fff8f0] p-3",
    statLabel: "text-[#8a6c5a]",
    badge: "border-orange-900/15 bg-orange-50 text-[#4a2a18]",
    empty: "border-orange-900/20 bg-[#fff8f0]",
    input:
      "rounded-2xl border border-orange-900/15 bg-white px-4 py-3 text-sm text-[#2b170f] outline-none placeholder:text-[#9b887b] focus:border-orange-500",
    modeButton:
      "rounded-2xl border border-[#4a2a18] bg-[#4a2a18] px-4 py-2 text-sm font-black text-white hover:bg-[#321d12]",
    secondaryButton:
      "rounded-2xl border border-orange-900/15 px-4 py-2 text-sm font-bold text-[#4a2a18] hover:bg-orange-50",
    summaryBubble: "border-orange-900/10 bg-[#fff8f0] text-[#3b261b]",
    detailBox: "border-orange-900/10 bg-[#fff8f0]",
    topLinkCard:
      "min-w-[260px] rounded-2xl border border-orange-900/10 bg-[#fff8f0] p-4 hover:border-orange-500/50",
  };
}

function extractSection(text: string, heading: string) {
  if (!text) return "";

  const pattern = new RegExp(
    `#{1,3}\\s*${escapeRegex(heading)}\\s*\\n([\\s\\S]*?)(?=\\n#{1,3}\\s+|$)`,
    "i"
  );

  const match = text.match(pattern);
  return cleanAIText(match?.[1] || "");
}

function cleanAIText(text: string) {
  return String(text || "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/---+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dateMs(value?: string) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDate(value?: string) {
  if (!value) return "—";

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function statusLabel(status?: string) {
  if (status === "ok") return "Live";
  if (status === "skipped") return "Skipped";
  if (status === "missing_api_key") return "Missing key";
  if (status === "openrouter_error") return "AI error";
  if (status === "fallback") return "Fallback";
  return status || "Unknown";
}
