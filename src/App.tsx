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

export default function App() {
  const [report, setReport] = useState<Report | null>(null);
  const [items, setItems] = useState<IntelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");

  async function loadReport() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${import.meta.env.BASE_URL}latest.json?ts=${Date.now()}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`Could not load latest.json from deployed base path. HTTP ${res.status}`);
      }

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

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();

    return items.filter((item) => {
      const matchesCategory =
        category === "All" || (item.category || "General Browns") === category;

      const haystack = [
        item.title,
        item.summary,
        item.source_name,
        item.source_type,
        item.category,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return matchesCategory && (!q || haystack.includes(q));
    });
  }, [items, query, category]);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <header className="rounded-3xl border border-orange-900/40 bg-gradient-to-br from-neutral-900 to-stone-950 p-6 shadow-2xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-orange-500">
                Browns Intelligence
              </p>
              <h1 className="mt-2 text-4xl font-black tracking-tight md:text-6xl">
                Command Center
              </h1>
              <p className="mt-3 max-w-3xl text-neutral-400">
                Live dashboard rendered from <code>/latest.json</code>. No mock
                articles. No browser-side AI calls. The Python bot creates the data.
              </p>
            </div>

            <button
              onClick={loadReport}
              className="rounded-2xl border border-orange-700/60 bg-orange-600 px-5 py-3 text-sm font-bold text-white shadow-lg hover:bg-orange-500"
            >
              Refresh Data
            </button>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-5">
            <Stat label="Generated" value={report?.generated_at || "Not loaded"} />
            <Stat label="Hours" value={String(report?.hours ?? "—")} />
            <Stat label="Items" value={String(items.length)} />
            <Stat label="AI Status" value={report?.ai_provider_status || "—"} />
            <Stat label="Model" value={report?.ai_model || "—"} />
          </div>
        </header>

        {loading && (
          <section className="mt-6 rounded-3xl border border-neutral-800 bg-neutral-900 p-6">
            Loading real bot data from <code>/latest.json</code>…
          </section>
        )}

        {error && (
          <section className="mt-6 rounded-3xl border border-red-900/60 bg-red-950/40 p-6">
            <h2 className="text-xl font-bold text-red-300">Could not load live data</h2>
            <p className="mt-2 text-red-100">{error}</p>
            <p className="mt-4 text-sm text-neutral-300">
              Run the bot first:
            </p>
            <pre className="mt-2 overflow-auto rounded-2xl bg-black p-4 text-sm text-neutral-200">
python browns_intel_bot.py --hours 72 --skip-ai
            </pre>
          </section>
        )}

        {!loading && !error && (
          <>
            <section className="mt-6 rounded-3xl border border-neutral-800 bg-neutral-900 p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-2xl font-black tracking-tight">
                    AI Intelligence Brief
                  </h2>
                  <p className="mt-1 text-sm text-neutral-400">
                    Provider: {report?.ai_provider || "—"} · Status:{" "}
                    {report?.ai_provider_status || "—"}
                  </p>
                </div>
              </div>

              <pre className="mt-5 whitespace-pre-wrap rounded-2xl border border-neutral-800 bg-black/50 p-5 text-sm leading-7 text-neutral-100">
{report?.ai_brief || "No AI brief available."}
              </pre>
            </section>

            <section className="mt-6 rounded-3xl border border-neutral-800 bg-neutral-900 p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-2xl font-black tracking-tight">
                    Real Source Cards
                  </h2>
                  <p className="mt-1 text-sm text-neutral-400">
                    Data source: <code>/latest.json</code> · Items loaded:{" "}
                    {items.length}
                  </p>
                </div>

                <div className="flex flex-col gap-3 md:flex-row">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search title, source, category…"
                    className="rounded-2xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm text-white outline-none focus:border-orange-500"
                  />

                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="rounded-2xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm text-white outline-none focus:border-orange-500"
                  >
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {items.length === 0 && (
                <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-6 text-neutral-300">
                  No real Browns items were collected in the latest run.
                </div>
              )}

              {items.length > 0 && filtered.length === 0 && (
                <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-6 text-neutral-300">
                  No real items match your filters.
                </div>
              )}

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {filtered.map((item, index) => (
                  <article
                    key={item.id || item.url || index}
                    className="rounded-3xl border border-neutral-800 bg-neutral-950 p-5 transition hover:border-orange-800/70"
                  >
                    <div className="flex flex-wrap gap-2">
                      <Badge>{item.category || "General Browns"}</Badge>
                      <Badge>{item.source_type || "source"}</Badge>
                      {item.source_tier_label && <Badge>{item.source_tier_label}</Badge>}
                      {typeof item.credibility_score === "number" && (
                        <Badge>Credibility {item.credibility_score}</Badge>
                      )}
                      {typeof item.score === "number" && <Badge>Score {item.score}</Badge>}
                      {item.is_new && <Badge>NEW</Badge>}
                    </div>

                    <h3 className="mt-4 text-xl font-black leading-tight">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-orange-400"
                      >
                        {item.title}
                      </a>
                    </h3>

                    <p className="mt-2 text-sm text-neutral-400">
                      {item.source_name || "Unknown Source"} · {item.published || "No date"}
                    </p>

                    <p className="mt-4 leading-7 text-neutral-200">
                      {item.summary || "No summary available."}
                    </p>

                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-5 inline-flex rounded-2xl border border-orange-800/70 px-4 py-2 text-sm font-bold text-orange-300 hover:bg-orange-950/40"
                      >
                        Open Source
                      </a>
                    )}
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-black/30 p-4">
      <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
        {label}
      </p>
      <p className="mt-2 break-words text-sm font-bold text-neutral-100">{value}</p>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs font-bold text-neutral-300">
      {children}
    </span>
  );
}
