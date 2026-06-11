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

const GOOGLE_NEWS_QUERIES = [
  "Cleveland Browns",
  "Cleveland Browns roster",
  "Cleveland Browns injury",
  "Cleveland Browns quarterback",
  "Cleveland Browns practice",
  "Cleveland Browns rumors",
  "Cleveland Browns press conference"
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

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();
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

function buildItem({ title, url, summary, published, query, provider }) {
  const cleanUrl = normalizeUrl(url);
  const domain = getDomain(cleanUrl);
  const item = {
    id: makeId(cleanUrl, title),
    title: String(title || "").trim(),
    url: cleanUrl,
    source_name: domain || provider,
    source_type: "web_search",
    source_tier_label: provider,
    credibility_score: provider === "Tavily Web Search" ? 62 : 58,
    domain,
    category: inferCategory(`${title} ${summary}`),
    published: published || new Date().toISOString(),
    summary: String(summary || "").trim(),
    score: provider === "Tavily Web Search" ? 35 : 32,
    score_reasons: ["web_search +10", "browns relevance filter"],
    is_new: true,
    discovered_by_query: query,
    collected_at: new Date().toISOString()
  };

  const relevance = brownsScore(item);
  if (!item.title || !item.url || relevance < 2) return null;

  item.score += relevance * 4;
  item.score_reasons.push(`browns_score +${relevance * 4}`);
  return item;
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

  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];

  return results.map((result) =>
    buildItem({
      title: result.title,
      url: result.url,
      summary: result.content,
      published: result.published_date,
      query,
      provider: "Tavily Web Search"
    })
  ).filter(Boolean);
}

async function googleNewsSearch(query) {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const response = await fetch(rssUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 BrownsIntelBot/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Google News RSS ${response.status}`);
  }

  const xml = await response.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, MAX_RESULTS_PER_QUERY);

  return items.map((match) => {
    const chunk = match[1];
    const title = decodeXml(chunk.match(/<title>([\s\S]*?)<\/title>/)?.[1]);
    const url = decodeXml(chunk.match(/<link>([\s\S]*?)<\/link>/)?.[1]);
    const summary = decodeXml(chunk.match(/<description>([\s\S]*?)<\/description>/)?.[1]);
    const published = decodeXml(chunk.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]);

    return buildItem({
      title,
      url,
      summary,
      published,
      query,
      provider: "Google News Search"
    });
  }).filter(Boolean);
}

async function main() {
  if (!fs.existsSync(DATA_PATH)) {
    console.log("public/latest.json not found. Skipping web search source.");
    return;
  }

  const report = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const existingItems = Array.isArray(report.items) ? report.items : [];
  const seenUrls = new Set(existingItems.map((item) => normalizeUrl(item.url)).filter(Boolean));
  const collectedAt = new Date().toISOString();
  const newItems = [];
  const providerNotes = [];

  if (TAVILY_API_KEY) {
    providerNotes.push("tavily");
    for (const query of SEARCH_QUERIES) {
      try {
        for (const item of await tavilySearch(query)) {
          if (seenUrls.has(item.url)) continue;
          item.collected_at = collectedAt;
          seenUrls.add(item.url);
          newItems.push(item);
        }
      } catch (error) {
        console.log(`Tavily web search failed for '${query}': ${error.message}`);
      }
    }
  } else {
    console.log("TAVILY_API_KEY missing. Using Google News RSS fallback.");
  }

  providerNotes.push("google_news_rss");
  for (const query of GOOGLE_NEWS_QUERIES) {
    try {
      for (const item of await googleNewsSearch(query)) {
        if (seenUrls.has(item.url)) continue;
        item.collected_at = collectedAt;
        seenUrls.add(item.url);
        newItems.push(item);
      }
    } catch (error) {
      console.log(`Google News RSS search failed for '${query}': ${error.message}`);
    }
  }

  report.items = [...newItems, ...existingItems];
  report.web_search = {
    provider: providerNotes.join("+"),
    collected_at: collectedAt,
    added: newItems.length,
    queries: TAVILY_API_KEY ? [...SEARCH_QUERIES, ...GOOGLE_NEWS_QUERIES] : GOOGLE_NEWS_QUERIES
  };

  fs.writeFileSync(DATA_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Added ${newItems.length} web search Browns items.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
