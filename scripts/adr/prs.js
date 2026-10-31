'use strict';

const { spawnSync } = require('child_process');

// Record files that open pull requests add or change, read with the GitHub CLI from the
// repository `root` belongs to. An open PR's record has claimed its number even though no base
// ref holds it yet, so `adr-lint next` must skip it. Returns `{ paths }` (repo-relative, forward
// slashes) or `{ error }` naming why the open PRs could not be read; never throws.
const LIMIT = 200;

function openPrFiles(root) {
    const r = spawnSync('gh', ['pr', 'list', '--state', 'open', '--limit', String(LIMIT), '--json', 'number,files'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 20000,
        env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' },
    });
    if (r.error && r.error.code === 'ENOENT') return { error: 'the GitHub CLI (gh) is not installed' };
    if (r.error) return { error: `gh failed: ${r.error.message}` };
    if (r.status !== 0) {
        const line = (r.stderr || '').trim().split('\n')[0] || `gh exited ${r.status}`;
        return { error: `gh pr list failed: ${line}` };
    }
    let prs;
    try { prs = JSON.parse(r.stdout); } catch { return { error: 'gh pr list printed something other than JSON' }; }
    if (!Array.isArray(prs)) return { error: 'gh pr list printed something other than a list' };
    const paths = [];
    for (const pr of prs) {
        for (const f of (pr && Array.isArray(pr.files) ? pr.files : [])) {
            if (f && typeof f.path === 'string') paths.push({ pr: pr.number, path: f.path });
        }
    }
    return { paths, truncated: prs.length >= LIMIT };
}

module.exports = { openPrFiles, LIMIT };
