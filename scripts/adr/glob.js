'use strict';

// Minimal glob for `scope` entries: `**` spans path segments, `*` and `?` stay within one.
// No braces or character classes; every other character is literal.

function toPosix(p) {
    return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function globToRegExp(glob) {
    const g = toPosix(glob);
    let re = '^';
    for (let i = 0; i < g.length; i++) {
        const c = g[i];
        if (c === '*' && g[i + 1] === '*') {
            if (g[i + 2] === '/') {
                re += '(?:[^/]*/)*';
                i += 2;
            } else {
                re += '.*';
                i += 1;
            }
        } else if (c === '*') {
            re += '[^/]*';
        } else if (c === '?') {
            re += '[^/]';
        } else {
            re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
    }
    return new RegExp(re + '$');
}

function matchesGlob(filePath, glob) {
    return globToRegExp(glob).test(toPosix(filePath));
}

module.exports = { globToRegExp, matchesGlob, toPosix };
