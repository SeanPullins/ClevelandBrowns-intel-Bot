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
    <main className="min-h-screen bg-[#08090c] text-zinc-100">
      <div className="mx-auto max-w-5xl px-3 py-4 md:px-6 md:py-8">
        <header className="rounded-3xl border border-white/10 bg-zinc-950 p-4 shadow-xl md:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-orange-400">
                Browns Intelligence
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-[-0.05em] text-white md:text-5xl">
                Daily Brief
              </h1>
              <p className="mt-2 text-sm leading-6 text-zinc-400 md:text-base">
                AI summary and links from the latest Browns stories.
              </p>
            </div>

            <button
              onClick={loadReport}
              className="shrink-0 rounded-2xl bg-orange-600 px-4 py-2 text-sm font-black text-white hover:bg-orange-500"
            >
              Refresh
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Updated" value={formatDate(report?.generated_at)} />
            <Stat label="Stories" value={String(items.length)} />
            <Stat label="New" value={String(items.filter((x) => x.is_new).length)} />
            <Stat label="AI" value={statusLabel(report?.ai_provider_status)} />
          </div>
        </header>

        {loading && <SimplePanel>Loading latest Browns report…</SimplePanel>}

        {error && (
          <SimplePanel className="border-red-800/50 bg-red-950/30">
            <h2 className="text-xl font-black text-red-200">Could not load report</h2>
            <p className="mt-2 text-sm text-red-100">{error}</p>
          </SimplePanel>
        )}

        {!loading && !error && (
          <>
            <section className="mt-4 rounded-3xl border border-orange-900/30 bg-gradient-to-br from-zinc-950 to-black p-4 shadow-xl md:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-orange-400">
                    AI Summary
                  </p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight text-white">
                    What matters
                  </h2>
                </div>

                <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-black uppercase text-zinc-400">
                  {report?.ai_model ? "AI" : "No AI"}
                </span>
              </div>

              {quickBullets.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {quickBullets.map((line, index) => (
                    <p key={index} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-sm leading-6 text-zinc-200">
                      {line}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-zinc-400">
                  No AI summary available yet.
                </p>
              )}

              {report?.ai_brief && (
                <div className="mt-4">
                  <button
                    onClick={() => setShowFullBrief((v) => !v)}
                    className="rounded-2xl border border-white/10 px-4 py-2 text-sm font-bold text-zinc-300 hover:bg-white/5"
                  >
                    {showFullBrief ? "Hide details" : "More AI detail"}
                  </button>

                  {showFullBrief && (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/35 p-4">
                      <ReadableText text={cleanAIText(report.ai_brief)} />
                    </div>
                  )}
                </div>
              )}
            </section>

            {topItems.length > 0 && (
              <section className="mt-4 rounded-3xl border border-white/10 bg-zinc-950 p-4 md:p-5">
                <h2 className="text-lg font-black text-white">Top links</h2>
                <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
                  {topItems.map((item, index) => (
                    <a
                      key={item.id || item.url || index}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-[260px] rounded-2xl border border-white/10 bg-black/30 p-4 hover:border-orange-500/50"
                    >
                      <p className="line-clamp-3 text-sm font-black leading-6 text-white">
                        {item.title}
                      </p>
                      <p className="mt-2 text-xs text-zinc-500">
                        {item.source_name || "Unknown source"}
                      </p>
                    </a>
                  ))}
                </div>
              </section>
            )}

            <section className="sticky top-0 z-20 mt-4 rounded-3xl border border-white/10 bg-zinc-950/95 p-3 backdrop-blur md:static md:p-5">
              <div className="grid gap-2 md:grid-cols-[1.4fr_0.8fr_0.8fr]">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search stories…"
                  className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-orange-500"
                />

                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-orange-500"
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
                  className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-orange-500"
                >
                  <option value="signal">Top signal</option>
                  <option value="newest">Newest</option>
                  <option value="credibility">Most credible</option>
                </select>
              </div>
            </section>

            <section className="mt-4 rounded-3xl border border-white/10 bg-zinc-950 p-4 md:p-6">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-orange-400">
                    Stories
                  </p>
                  <h2 className="mt-1 text-2xl font-black text-white">
                    Found links
                  </h2>
                </div>
                <p className="text-sm font-bold text-zinc-500">
                  {filteredItems.length}/{items.length}
                </p>
              </div>

              {items.length === 0 && (
                <EmptyState
                  title="No real Browns stories collected"
                  body="The bot did not find real source items in the latest run."
                />
              )}

              <div className="mt-4 divide-y divide-white/10">
                {filteredItems.map((item, index) => (
                  <StoryCompact key={item.id || item.url || index} item={item} />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function StoryCompact({ item }: { item: IntelItem }) {
  return (
    <article className="py-4">
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge>{item.category || "General Browns"}</Badge>
            {item.is_new && <Badge tone="green">New</Badge>}
          </div>

          <h3 className="text-base font-black leading-6 text-white md:text-lg">
            <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-orange-300">
              {item.title}
            </a>
          </h3>

          <p className="mt-1 text-xs text-zinc-500">
            {item.source_name || "Unknown source"} · {formatDate(item.published)}
          </p>

          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-bold text-orange-300">
              Summary
            </summary>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-sm font-black text-zinc-100">{value}</p>
    </div>
  );
}

function SimplePanel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`mt-4 rounded-3xl border border-white/10 bg-zinc-950 p-5 ${className}`}>
      {children}
    </section>
  );
}

function Badge({ children, tone = "zinc" }: { children: React.ReactNode; tone?: "zinc" | "green" }) {
  const classes =
    tone === "green"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : "border-white/10 bg-white/[0.04] text-zinc-300";

  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${classes}`}>{children}</span>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-black/25 p-6 text-center">
      <h3 className="text-lg font-black text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{body}</p>
    </div>
  );
}

function ReadableText({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className="space-y-3 text-sm leading-7 text-zinc-300">
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
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
