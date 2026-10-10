# mcp-hrc-voting

[![MCP](https://img.shields.io/badge/MCP-Server-blue)](https://modelcontextprotocol.io) [![Node](https://img.shields.io/badge/Node-18%2B-brightgreen)](https://nodejs.org) [![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-orange)](LICENSE) [![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21281232.svg)](https://doi.org/10.5281/zenodo.21281232)

Model Context Protocol server for **UN human-rights voting records**: how States voted at the Commission on
Human Rights (1946–2006), the Human Rights Council (2006–) and, as plenary votes, the General Assembly's Third
Committee (1970–). Nine read-only tools and four reference documents, answered from a **bundled offline
snapshot** of the [HRC Voting](https://lszoszk.github.io/hrc-voting/) dataset: no network, no API key, nothing to
configure.

What makes it more than a lookup: the dataset's safeguards are the defaults. Amendments are kept apart from
resolutions, an abstention is never a vote against, every result states its scope and the dataset version, and the
known gaps of the source catalogue are one tool call away. The server's `instructions` tell the client the same.

Companion to the [HRC Voting dashboard](https://lszoszk.github.io/hrc-voting/) (with a plain page for every State and
every recorded resolution), the [Claude skills](https://lszoszk.github.io/hrc-voting/skills/) built on the same
snapshot, and the sibling servers [mcp-unhrdb](https://github.com/lszoszk/mcp-unhrdb) and [mcp-echr](https://github.com/lszoszk/mcp-echr).

## Tools

| Tool | What it answers |
|---|---|
| `hrc_voting_info` | Dataset version, snapshot date, coverage and licence. Call it once to know the scope. |
| `hrc_voting_search_resolutions` | Find resolutions and decisions by words in the symbol, title, subject or agenda item; filters for body, years, adoption mode (recorded / consensus); paged. Amendments excluded unless asked. |
| `hrc_voting_get_resolution` | One text by UN symbol (resolution, General Assembly resolution or amendment): tally, outcome, who voted Yes / No / Abstain / absent, OHCHR source record, plain page. |
| `hrc_voting_country_record` | A State's record: votes cast, Yes/No/Abstain shares, absences, year by year, latest votes; `body: "ga"` for the General Assembly (kept separate). |
| `hrc_voting_voting_partners` | Closest and furthest voting partners on shared recorded votes, with shared-vote counts. |
| `hrc_voting_compare_countries` | Two States head to head: agreement, Yes-vs-No clashes, overlap years, latest disagreements. |
| `hrc_voting_adoption_modes` | Adopted without a vote vs by recorded vote, per year. |
| `hrc_voting_amendments` | Amendments to draft texts by outcome and year, with the catalogue gaps flagged. |
| `hrc_voting_known_gaps` | What the OHCHR catalogue lacks (two of the Council's three rejected drafts and 21 amendments in 2020–2024), no-action motions, totals verified against the Council's session reports. |

Resources (`hrcv://docs/pitfalls`, `known-gaps`, `schema`, `verification`) hold the reasoning behind the safeguards and how to check a
published figure against the session reports. Every tool carries `readOnlyHint`, returns both text and `structuredContent`,
and answers a wrong input (an ambiguous country, an unknown symbol) with an error that says what to do next.

Try: *"How did Poland vote at the Human Rights Council since 2006, and which States did it vote with most?"* ·
*"Is it true that only four HRC amendments were adopted in 2020–2024?"* · *"Who voted No on A/HRC/RES/48/1?"*

## Two transports

| Transport | Entry | Use it for |
|---|---|---|
| **stdio** | `src/index.js` (`npm start`) | Claude Desktop, Claude Code: the client spawns it locally |
| **HTTP** (Streamable HTTP, stateless) | `src/http.js` (`npm run start:http`) | Remote clients and self-hosting; `/health`, optional `MCP_AUTH_TOKEN` |

There is no hosted endpoint yet; run it locally (below) or host the HTTP entry yourself.

## Install

Requires Node.js ≥ 18. No clone needed: the client can fetch and run the server straight from GitHub.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` and restart the app:

```json
{
  "mcpServers": {
    "hrc-voting": {
      "command": "npx",
      "args": ["-y", "github:lszoszk/mcp-hrc-voting"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add --scope user hrc-voting -- npx -y github:lszoszk/mcp-hrc-voting
```

The nine tools appear under the 🔌 menu. A stdio server prints one line to stderr when ready
(`mcp-hrc-voting 1.2.0 (stdio) ready · dataset v1.2.0 …`). The first start takes a few seconds while npm fetches the package.

### From a clone (development)

```bash
git clone https://github.com/lszoszk/mcp-hrc-voting
cd mcp-hrc-voting
npm install
npm test        # 15 tests, including the protocol end to end and the ten evaluation answers
```

and point the client at the file instead: `"command": "node", "args": ["/ABSOLUTE/PATH/TO/mcp-hrc-voting/src/index.js"]`.

### Remote / HTTP

```bash
PORT=8005 node src/http.js          # POST /mcp (Streamable HTTP), GET /health
```

Put it behind a TLS proxy and set `MCP_AUTH_TOKEN` (or gate the route at the proxy) if it is not meant to be open.

## Configuration (env)

| Variable | Default | Notes |
|---|---|---|
| `MCP_HRC_VOTING_DATA` | _(bundled `data/`)_ | A directory with `resolutions.csv`, `votes_long.csv`, `ga_resolutions.csv`, `ga_votes_long.csv` (plain or `.gz`), e.g. `data/csv` of a newer [hrc-voting](https://github.com/lszoszk/hrc-voting) checkout. Countries and documents still come from the package. |
| `PORT`, `HOST`, `MCP_AUTH_TOKEN` | 8005, 127.0.0.1, _(none)_ | HTTP entry only. |

## Data and versions

The package version is the dataset version (`1.2.0` = HRC Voting v1.2.0, harvest of 26 September 2026, release of
28 September 2026: 6,392 Commission and Council records, 1,716 with a per-State roll-call, 80,676 country-vote rows,
708 General Assembly resolutions adopted by recorded vote). To move to a newer release:

```bash
node scripts/sync-data.js ../OHCHR_voting    # copies the snapshot and the reference documents from a hrc-voting checkout
npm test                                     # golden values belong to v1.2.0: re-derive them, and evaluation.xml
```

Not bundled: General Assembly committee-stage votes and resolution texts (see the
[Hugging Face dataset](https://huggingface.co/datasets/lszoszk/hrc-voting)). The two implementations that read this
snapshot, this server and the skill's `hrcv.py`, are kept honest against each other: the golden values in
`test/queries.test.js` come from the reference CLI.

## Evaluation

`evaluation.xml` holds ten read-only questions that need several tool calls each, with one verifiable answer
(MCP evaluation format). `test/evaluation.test.js` re-derives the answers from the data.

## Cite

> Szoszkiewicz, Ł. (2026). *mcp-hrc-voting* (v1.2.0) [Software]. https://github.com/lszoszk/mcp-hrc-voting

and the dataset: Szoszkiewicz, Ł. (2026). *UN Human Rights Voting Records — CHR · HRC · GA Third Committee* (v1.2.0)
[Software]. Zenodo. https://doi.org/10.5281/zenodo.21281232. Cite resolutions by their UN symbol and, for a tally, the OHCHR
record URL the tools return.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE): research, education, non-profit and personal use are free; commercial use needs a
separate licence from the author. The voting records are public UN documents; the General Assembly voting data are
"Copyright, United Nations; non-commercial use, with attribution". HRC Voting is independent of the United Nations.
