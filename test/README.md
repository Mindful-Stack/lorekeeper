# Plugin Test Harness

Automated tests for the lorekeeper plugin using Babashka.

## Setup

### Install Babashka

**Windows (scoop):**
```bash
scoop install babashka
```

**Windows (winget):**
```bash
winget install babashka
```

**Mac:**
```bash
brew install borkdude/brew/babashka
```

**Linux:**
```bash
bash < <(curl -s https://raw.githubusercontent.com/babashka/babashka/master/install)
```

### Verify Installation

```bash
bb --version
```

## Running Tests

### Run All Tests

```bash
cd shared-knowledge/plugin
bb test/run-tests.clj
```

### Filter by Name

```bash
bb test/run-tests.clj --filter "command-help"
bb test/run-tests.clj --filter "skill"
```

### Verbose Output (show full output on failures)

```bash
bb test/run-tests.clj --verbose
```

## Test Scenarios

Tests are defined in `scenarios.edn` as pure data:

```clojure
{:name "command-help"
 :prompt "/lore:help"
 :workdir "."
 :expects ["Knowledge" "commands"]}
```

- **name**: Test identifier
- **prompt**: What to send to Claude
- **workdir**: Directory to run in (relative to knowledge repo root, usually ".")
- **expects**: Regex patterns that must appear in output

## How It Works

1. Runs Claude CLI with `--print` flag for each prompt
2. Checks output for expected patterns
3. Reports pass/fail for each scenario

## Adding New Tests

Edit `scenarios.edn` and add a new map:

```clojure
{:name "my-new-test"
 :prompt "Your test prompt here"
 :workdir "."
 :expects ["pattern-to-match" "another-pattern"]}
```

## Manual Debugging

For deeper debugging during development, the plugin supports a debug mode. Create a `.knowledge-debug` file in the knowledge repo root:

```bash
touch /path/to/knowledge-repo/.knowledge-debug
```

Then start a Claude session manually. The hook will instruct Claude to output debug lines like:

```
[KNOWLEDGE:DEBUG] hook_fired=SessionStart
[KNOWLEDGE:DEBUG] path_resolved=/path/to/knowledge
[KNOWLEDGE:DEBUG] command=help
[KNOWLEDGE:DEBUG] skill_triggered=knowledge-discovery
[KNOWLEDGE:DEBUG] files_loaded=["path1", "path2"]
```

Remove the file when done:
```bash
rm /path/to/knowledge-repo/.knowledge-debug
```

**Note:** Debug mode relies on Claude following system message instructions, which works well in interactive sessions but is unreliable for automated tests. For automated testing, we verify command output patterns instead.

### Future Enhancement

For more reliable automated debugging, consider implementing file-based logging where the hook writes to a log file that tests can check after each run. This would provide deterministic debug output independent of Claude's response behavior.
