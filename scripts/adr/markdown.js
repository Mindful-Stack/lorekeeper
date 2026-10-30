'use strict';

// The one fence-aware reading of a record or behaviour doc: every line outside fenced code,
// tagged with the `## ` section it sits in. Fences follow CommonMark: a closer uses the
// opener's character, a run at least as long, and nothing else on the line.

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

// Returns { sections: [heading, ...], lines: [{ section, text }], fenced: [{ section, text }] }.
// Heading lines themselves are not in `lines`; text before the first heading has section null.
// `fenced` holds the lines inside fences (not the fence lines), for warnings only.
function walk(text) {
    const sections = [];
    const lines = [];
    const fenced = [];
    let fence = null;
    let section = null;
    for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
        if (fence) {
            const close = new RegExp(`^ {0,3}${fence.ch}{${fence.len},}[ \\t]*$`);
            if (close.test(line)) fence = null;
            else fenced.push({ section, text: line });
            continue;
        }
        const open = FENCE_OPEN.exec(line);
        if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
            fence = { ch: open[1][0], len: open[1].length };
            continue;
        }
        const h = /^## (.+?)\s*$/.exec(line);
        if (h) {
            section = h[1];
            sections.push(section);
            continue;
        }
        lines.push({ section, text: line });
    }
    return { sections, lines, fenced };
}

module.exports = { walk };
