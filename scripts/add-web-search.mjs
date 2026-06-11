import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DATA_PATH = path.join(process.cwd(), "public", "latest.json");
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const MAX_RESULTS_PER_QUERY = Number(process.env.WEB_SEARCH_MAX_RESULTS || 5);

const SEARCH_QUERIES = [
  "Cleveland Browns news",
  "Cleveland Browns roster moves",
  "Cleveland Browns injuries",
  "Cleveland Browns quarterback news",
  "Cleveland Browns rumors",
  "Cleveland Browns practice report",
  "Cleveland Browns press conference",
  "site:clevelandbrowns.com Browns",
  "site:cleveland.com Browns",
  "site:espn.com Cleveland Browns",
  "site:nfl.com Cleveland Browns"
];

const STRONG_TERMS = [
  "cleveland browns",
  "clevelandbrowns.com",
  "browns wire",
  "dawgs by nature",
  "orange and brown report"
];

const MEDIUM_TERMS = [
  "browns",
  "berea",
  "myles garrett",
  "deshaun watson",
  "shedeur sanders",
  "dillon gabriel",
  "joe flacco",
  "andrew berry",
  "todd monken"
];

const NEGATIVE_TERMS = [
  "brown university",
  "brown bears",
  "james brown",
  "brown sugar",
  "chris brown",
  "antonio brown",
  "brown county",
  "brownsburg"
];

function normalizeUrl(value) {
  if (!value) return "";
  return String(value).trim().replace(/[?#].*$/, "").replace(/\/$/, "");
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function brownsScore(item) {
  const haystack = [item.title, item.summary, item.url, item.source_name, item.domain]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const term of STRONG_TERMS) if (haystack.includes(term)) score += 3;
  for (const term of MEDIUM_TERMS) if (haystack.includes(term)) score += 1;
  for (const term of NEGATIVE_TERMS) if (haystack.includes(term)) score -= 10;
  return score;
}

function inferCategory(text) {
  const value = String(text || "").toLowerCase();
  if (/watson|shedeur|dillon gabriel|flacco|quarterback|qb/.test(value)) return "QB Room";
  if (/injury|injured|practice|ota|training camp|availability/.test(value)) return "Roster / Injury Movement";
  if (/draft|rookie|prospect|minicamp/.test(value)) return "Draft Intel";
  if (/berry|monken|coach|front office|owner|ownership|staff/.test(value)) return "Front Office / Coaching";
  if (/odds|betting|line|market|spread|futures/.test(value)) return "Market / Betting Implications";
  return "General Browns";
}

function makeId(url, title) {
  return crypto.createHash("sha256").update(`${url}|${title}`).digest("hex").slice(0, 16);
}

async function tavilySearch(query) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      topic: "news",
      search_depth: "advanced",
      days: 7,
      max_results: MAX_RESULTS_PER_QUERY,
      include_answer: false,
      include_raw_content: false
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Tavily ${response.status}: ${body.slice(0, 200)}`);
  }

  return response.json();
}

async function main() {
  if (!fs.existsSync(DATA_PATH)) {
    console.log("public/latest.json not found. Skipping web search source.");
    return;
  }

  if (!TAVILY_API_KEY) {
    console.log("TAVILY_API_KEY missing. Skipping web search source.");
    return;
  }

  const report = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const existingItems = Array.isArray(report.items) ? report.items : [];
  const seenUrls = new Set(existingItems.map((item) => normalizeUrl(item.url)).filter(Boolean));
  const collectedAt = new Date().toISOString();
  const newItems = [];

  for (const query of SEARCH_QUERIES) {
    try {
      const data = await tavilySearch(query);
      const results = Array.isArray(data.results) ? data.results : [];

      for (const result of results) {
        const url = normalizeUrl(result.url);
        if (!url || seenUrls.has(url)) continue;

        const title = String(result.title || "").trim();
        const summary = String(result.content || "").trim();
        const domain = getDomain(url);

        if (!title) continue;

        const item = {
          id: makeId(url, title),
          title,
          url,
          source_name: domain || "Web Search",
          source_type: "web_search",
          source_tier_label: "Web Search",
          credibility_score: 62,
          domain,
          category: inferCategory(`${title} ${summary}`),
          published: result.published_date || collectedAt,
          summary,
          score: 35,
          score_reasons: ["web_search +10", "browns relevance filter"],
          is_new: true,
          discovered_by_query: query,
          collected_at: collectedAt
        };

        const relevance = brownsScore(item);
        if (relevance < 2) continue;

        item.score += relevance * 4;
        item.score_reasons.push(`browns_score +${relevance * 4}`);

        seenUrls.add(url);
        newItems.push(item);
      }
    } catch (error) {
      console.log(`Web search failed for '${query}': ${error.message}`);
    }
  }

  report.items = [...newItems, ...existingItems];
  report.web_search = {
    provider: "tavily",
    collected_at: collectedAt,
    added: newItems.length,
    queries: SEARCH_QUERIES
  };

  fs.writeFileSync(DATA_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Added ${newItems.length} web search Browns items.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
