'use strict';

// Guards against the bug fixed in fix/cultivate-skill-collision (mirrors the earlier
// fix/review-skill-collision): a command file and a skill directory with the same
// name both resolve to `lore:<name>`. The slash command expands the command file,
// and the Skill tool call it tells the model to make then comes back as "already
// loaded above; instructions unchanged" because the name is taken — the skill body
// never reaches the model.
//
// There is no tooling rule that prevents this; it only shows up when you trace a
// run. This test makes the constraint explicit: no commands/<name>.md may share a
// name with a skills/<name>/ directory.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN_ROOT = path.resolve(__dirname, '../..');

/**
 * Lists the command names (from commands/<name>.md) that collide with a
 * skills/<name>/ directory of the same name. Exported so this can be exercised
 * against a synthetic layout as well as the real plugin root.
 */
function findCommandSkillCollisions(pluginRoot) {
    const commandsDir = path.join(pluginRoot, 'commands');
    const skillsDir = path.join(pluginRoot, 'skills');
    if (!fs.existsSync(commandsDir) || !fs.existsSync(skillsDir)) {
        return [];
    }

    const commandNames = fs.readdirSync(commandsDir)
        .filter((entry) => entry.endsWith('.md'))
        .map((entry) => entry.slice(0, -'.md'.length));

    const skillNames = new Set(
        fs.readdirSync(skillsDir)
            .filter((entry) => fs.statSync(path.join(skillsDir, entry)).isDirectory())
    );

    return commandNames.filter((name) => skillNames.has(name)).sort();
}

module.exports = { findCommandSkillCollisions };

test('no commands/<name>.md shares a name with a skills/<name>/ directory', () => {
    const collisions = findCommandSkillCollisions(PLUGIN_ROOT);
    assert.deepEqual(
        collisions,
        [],
        `command/skill name collision(s): ${collisions.join(', ')} — rename the skill ` +
        'directory (see fix/cultivate-skill-collision and fix/review-skill-collision for ' +
        'the pattern: keep the command file, rename the skill directory and its ' +
        'frontmatter `name`, update every reference).'
    );
});

test('the detector would have caught the review and cultivate collisions', () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-layout-')));
    try {
        fs.mkdirSync(path.join(tmp, 'commands'), { recursive: true });
        // Both now-fixed collisions, plus a non-colliding command and a
        // non-colliding skill, so the detector has to discriminate, not just
        // report "everything."
        fs.writeFileSync(path.join(tmp, 'commands', 'review.md'), '');
        fs.writeFileSync(path.join(tmp, 'commands', 'cultivate.md'), '');
        fs.writeFileSync(path.join(tmp, 'commands', 'help.md'), '');

        fs.mkdirSync(path.join(tmp, 'skills', 'review'), { recursive: true });
        fs.mkdirSync(path.join(tmp, 'skills', 'cultivate'), { recursive: true });
        fs.mkdirSync(path.join(tmp, 'skills', 'cultivate-discovery'), { recursive: true });

        assert.deepEqual(findCommandSkillCollisions(tmp), ['cultivate', 'review']);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('the detector reports no collision once the skill directories are renamed', () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-layout-fixed-')));
    try {
        fs.mkdirSync(path.join(tmp, 'commands'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'commands', 'review.md'), '');
        fs.writeFileSync(path.join(tmp, 'commands', 'cultivate.md'), '');

        fs.mkdirSync(path.join(tmp, 'skills', 'reviewing-changes'), { recursive: true });
        fs.mkdirSync(path.join(tmp, 'skills', 'cultivating-domains'), { recursive: true });
        fs.mkdirSync(path.join(tmp, 'skills', 'cultivate-discovery'), { recursive: true });

        assert.deepEqual(findCommandSkillCollisions(tmp), []);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('the three manifests carry the same version', () => {
    const v = (p) => JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, p), 'utf8')).version;
    const versions = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'package.json'].map(v);
    assert.equal(new Set(versions).size, 1, versions.join(' / '));
});
