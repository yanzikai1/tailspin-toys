import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import {
    CanvasError,
    createCanvas,
    joinSession,
} from "@github/copilot-sdk/extension";

const execFileAsync = promisify(execFile);
const servers = new Map();
const repository = "yanzikai1/tailspin-toys";

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function summarizeBody(body) {
    const firstSection = body
        .split(/\n\s*\n/)
        .map((section) => section.trim())
        .find((section) => section && !section.startsWith("#"));

    if (!firstSection) {
        return "No description was provided.";
    }

    return firstSection.length > 320
        ? `${firstSection.slice(0, 317).trimEnd()}...`
        : firstSection;
}

function priorityFor(issue) {
    const text = `${issue.title}\n${issue.body}`.toLowerCase();
    let score = 0;
    let reason = "Open work ready for triage after the higher-impact items.";

    if (issue.author?.login === "yanzikai1") {
        score += 100;
        reason =
            "This is an explicit maintainer-authored request and is the freshest signal of immediate intent.";
    } else if (text.includes("coding standards")) {
        score += 90;
        reason =
            "Repository-wide standards affect every subsequent contribution, so resolving this early prevents inconsistent follow-on work.";
    } else if (text.includes("pagination")) {
        score += 70;
        reason =
            "This addresses the stated catalog performance risk and establishes list behavior that search and sorting work should account for.";
    } else if (text.includes("search") || text.includes("sort")) {
        score += 45;
        reason =
            "This improves a core catalog journey, but should follow the higher-impact standards and scalability work.";
    } else {
        score += 25;
    }

    score += new Date(issue.updatedAt).getTime() / 1e13;
    return { score, reason };
}

async function loadIssues() {
    const { stdout } = await execFileAsync(
        "gh",
        [
            "issue",
            "list",
            "--repo",
            repository,
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            "number,title,body,labels,assignees,author,createdAt,updatedAt,url",
        ],
        {
            cwd: session.workspacePath,
            windowsHide: true,
            maxBuffer: 2 * 1024 * 1024,
        },
    );

    return JSON.parse(stdout)
        .map((issue) => ({ ...issue, priority: priorityFor(issue) }))
        .sort((a, b) => b.priority.score - a.priority.score);
}

function renderCard(issue, featured) {
    const labels = issue.labels
        .map(
            (label) =>
                `<span class="label">${escapeHtml(label.name)}</span>`,
        )
        .join("");

    return `<article class="card${featured ? " featured" : ""}">
        <div class="card-heading">
            <span class="issue-number">#${issue.number}</span>
            ${labels}
        </div>
        <h3>${escapeHtml(issue.title)}</h3>
        <p class="description">${escapeHtml(summarizeBody(issue.body))}</p>
        ${
            featured
                ? `<div class="reason"><strong>Why now</strong><p>${escapeHtml(issue.priority.reason)}</p></div>`
                : ""
        }
        <div class="card-actions">
            <a href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">View issue</a>
            <button type="button" data-issue="${issue.number}">Add to context</button>
        </div>
    </article>`;
}

function renderHtml(issues) {
    const featured = issues.slice(0, 3);
    const remaining = issues.slice(3);

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Issue triage</title>
    <style>
        :root { color-scheme: light dark; }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            background: var(--background-color-default, #0d1117);
            color: var(--text-color-default, #f0f6fc);
            font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
            font-size: var(--text-body-medium, 14px);
            line-height: var(--leading-body-medium, 20px);
        }
        main { max-width: 1180px; margin: 0 auto; padding: 28px; }
        header { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
        h1 { margin: 0 0 6px; font-size: var(--text-title-large, 26px); line-height: 1.2; }
        h2 { margin: 0; font-size: var(--text-title-medium, 20px); }
        h3 { margin: 10px 0 8px; font-size: 16px; line-height: 1.35; }
        p { margin: 0; }
        .muted, .status { color: var(--text-color-muted, #8b949e); }
        .section-heading { display: flex; align-items: center; justify-content: space-between; margin: 0 0 12px; }
        .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
        .backlog { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        section + section { margin-top: 34px; padding-top: 26px; border-top: 1px solid var(--border-color-default, #30363d); }
        .card {
            display: flex;
            flex-direction: column;
            min-width: 0;
            padding: 17px;
            border: 1px solid var(--border-color-default, #30363d);
            border-radius: 12px;
            background: color-mix(in srgb, var(--background-color-default, #0d1117) 92%, var(--color-white, #fff) 8%);
        }
        .featured {
            border-top: 3px solid var(--true-color-red, #f85149);
            box-shadow: 0 8px 26px rgb(0 0 0 / 18%);
        }
        .card-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
        .issue-number { color: var(--text-color-muted, #8b949e); font-family: var(--font-mono, Consolas, monospace); }
        .label { padding: 1px 7px; border: 1px solid var(--border-color-default, #30363d); border-radius: 999px; font-size: 11px; }
        .description { color: var(--text-color-muted, #8b949e); }
        .reason {
            margin-top: 15px;
            padding: 11px 12px;
            border-left: 3px solid var(--true-color-blue, #58a6ff);
            border-radius: 6px;
            background: var(--true-color-blue-muted, rgb(56 139 253 / 12%));
        }
        .reason strong { display: block; margin-bottom: 4px; font-size: 12px; }
        .card-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: auto; padding-top: 18px; }
        a { color: var(--true-color-blue, #58a6ff); text-decoration: none; }
        a:hover { text-decoration: underline; }
        button {
            border: 1px solid var(--border-color-default, #30363d);
            border-radius: 7px;
            padding: 7px 11px;
            background: var(--true-color-blue, #1f6feb);
            color: var(--color-white, #fff);
            font: inherit;
            font-weight: var(--font-weight-semibold, 600);
            cursor: pointer;
        }
        button:hover { filter: brightness(1.08); }
        button:focus-visible, a:focus-visible { outline: 2px solid var(--color-focus-outline, #58a6ff); outline-offset: 2px; }
        button:disabled { cursor: wait; opacity: .65; }
        @media (max-width: 850px) { .grid, .backlog { grid-template-columns: 1fr; } }
        @media (max-width: 520px) { main { padding: 18px; } header { align-items: start; flex-direction: column; } }
    </style>
</head>
<body>
<main>
    <header>
        <div>
            <h1>Issue triage</h1>
            <p class="muted">${issues.length} open issues in ${repository}</p>
        </div>
        <p id="status" class="status" role="status" aria-live="polite">Ranked by urgency and project impact</p>
    </header>
    <section aria-labelledby="attention-heading">
        <div class="section-heading">
            <h2 id="attention-heading">Needs attention now</h2>
            <span class="muted">Top ${featured.length}</span>
        </div>
        <div class="grid">${featured.map((issue) => renderCard(issue, true)).join("")}</div>
    </section>
    <section aria-labelledby="backlog-heading">
        <div class="section-heading">
            <h2 id="backlog-heading">Remaining work</h2>
            <span class="muted">${remaining.length} issues</span>
        </div>
        <div class="grid backlog">${remaining.map((issue) => renderCard(issue, false)).join("")}</div>
    </section>
</main>
<script>
    const status = document.querySelector("#status");
    document.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-issue]");
        if (!button) return;

        const number = Number(button.dataset.issue);
        button.disabled = true;
        status.textContent = "Adding #" + number + " to this session...";

        try {
            const response = await fetch("/context", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ number }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Unable to add issue");
            button.textContent = "Added";
            status.textContent = "Issue #" + number + " added to the current session";
        } catch (error) {
            button.disabled = false;
            status.textContent = error.message;
        }
    });
</script>
</body>
</html>`;
}

async function addIssueToContext(number) {
    const issues = await loadIssues();
    const issue = issues.find((candidate) => candidate.number === number);
    if (!issue) {
        throw new CanvasError("issue_not_found", `Open issue #${number} was not found.`);
    }

    await session.send({
        prompt: `Work on GitHub issue #${issue.number}: ${issue.title}

Issue URL: ${issue.url}

${issue.body}

Please investigate the repository, implement the issue completely, and follow all repository contribution instructions.`,
    });

    return { number: issue.number, title: issue.title, added: true };
}

async function readJsonBody(req) {
    let body = "";
    for await (const chunk of req) {
        body += chunk;
        if (body.length > 16_384) {
            throw new Error("Request body is too large.");
        }
    }
    return JSON.parse(body || "{}");
}

async function startServer(instanceId) {
    let issues = await loadIssues();
    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? "/", "http://127.0.0.1");
            if (req.method === "POST" && url.pathname === "/context") {
                const input = await readJsonBody(req);
                const result = await addIssueToContext(Number(input.number));
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(result));
                return;
            }
            if (req.method === "POST" && url.pathname === "/refresh") {
                issues = await loadIssues();
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ count: issues.length }));
                return;
            }
            if (req.method !== "GET" || url.pathname !== "/") {
                res.writeHead(404).end();
                return;
            }
            res.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
                "Content-Security-Policy":
                    "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
            });
            res.end(renderHtml(issues));
        } catch (error) {
            res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/`, instanceId };
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "issue-triage-board",
            displayName: "Issue triage board",
            description:
                "Ranks open repository issues and lets the user add any issue directly to the current session context.",
            actions: [
                {
                    name: "refresh_issues",
                    description: "Reload and rerank the repository's open issues.",
                    handler: async () => {
                        const issues = await loadIssues();
                        return {
                            count: issues.length,
                            topIssues: issues.slice(0, 3).map(({ number, title }) => ({
                                number,
                                title,
                            })),
                        };
                    },
                },
                {
                    name: "add_issue_to_context",
                    description: "Add one open GitHub issue to the active session and start work on it.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            number: { type: "integer", minimum: 1 },
                        },
                        required: ["number"],
                    },
                    handler: async (ctx) => addIssueToContext(ctx.input.number),
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId);
                    servers.set(ctx.instanceId, entry);
                }
                return {
                    title: "Issue triage",
                    status: "Live GitHub issues",
                    url: entry.url,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(resolve));
                }
            },
        }),
    ],
});
