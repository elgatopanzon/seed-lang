# Seed distillation exclusions

This report is contract input, not active implementation or verification authority.
It preserves terminal presentation behavior for a later `seed/app-ui/seed.yml` and
records non-visual genomes that are useful but not honest master contracts today.

## Visual UI boundary

Master excludes visual layout, styling, ANSI palette, terminal cell geometry,
wrapping, paging choreography, screenshots, exact frames, and documentation
imagery. Non-visual data completeness, deterministic ordering, plain-text
readability, warnings and errors, exit status, accessibility without ANSI, and
large-output completion remain in master.

## Complete current visual inventory

### Blueprint presentation

- Markdown begins with `# Seed Blueprint`; semantic sections use fixed `##`
  headings after source, applied-genome, filter, and external-dependency context.
- Address depth maps to progressively deeper headings capped at H6. Explicit
  titles override generated titles; generated titles preserve terms including
  CLI, JSON, Node.js, PTY, TUI, UI, and YAML.
- Parent fields represented by direct child addresses are suppressed. Descriptions
  render as prose; scalar properties use strong labels; arrays use bullets or
  YAML fences; objects use YAML fences.
- Items show italic address and source metadata joined with ` · `. External
  dependencies have their own headings and Seed, address, source, and genome
  metadata. Missing ancestors are synthesized; selected empty sections show
  `_No entries._`.
- Unresolved requirements prepend a warning banner headed
  `# ⚠ SEED NOT READY: UNRESOLVED REQUIREMENTS` before the normal blueprint.
- `--head` and `--tail` window rendered Markdown, retain a final newline, and use
  exactly `...` when a middle range is omitted.

Sources: `src/blueprint.js`, `src/cli.js`, `test/cli.test.js`, and README blueprint
documentation. These are inventory references, not master UI acceptance.

### ANSI and plain presentation

- Automatic Markdown color requires a TTY, no `NO_COLOR` key, and `TERM` other
  than `dumb`. Explicit `--color` or `--no-color` overrides detection; supplying
  both fails.
- Current theme maps bullets to cyan, code to yellow, emphasis to italic, links
  to blue underline, metadata and quotes to gray, sections to bold green, strings
  to red, and strong text to bold.
- Blueprint rendering applies line windows, then coloring, then optional paging.
  JSON bypasses Markdown coloring and paging.
- Diff color currently keys only from TTY state unless `--no-color` is supplied,
  so its automatic policy differs from Markdown's `NO_COLOR` and `TERM=dumb`
  handling. Explicit `--color` is not a diff option.

Sources: `src/terminal-markdown.js`, `src/diff.js`, `src/cli.js`,
`test/terminal-markdown.test.js`, and `test/cli.test.js`.

### Genome list table

- Genome list is a four-column table: Origin, Genome, Source, Description, with
  two-space separators and a dash separator row.
- Width uses positive `COLUMNS`, then `stdout.columns`, then 80. Origin is
  content-sized. Remaining space is clamped, apportioned to ID and Source with
  minimums/caps, and Description receives the remainder.
- Cells normalize whitespace, wrap words, hard-slice long unbroken values, expand
  rows vertically, and trim trailing spaces. Empty results show
  `No genomes found.`.

Source: `src/cli.js` and deterministic `COLUMNS=78` assertions in
`test/cli.test.js`.

### Diff, status, and warning views

- Compact diffs use red `--- old`, green `+++ new`, `@@` hunk headers, red
  removals, green additions, plain context, three context lines, and merged
  adjacent ranges.
- Seed and Blueprint diff reuse the unresolved-requirements warning. Blueprint
  diff intentionally suppresses source/genome decoration for semantic comparison.
- Human audit/report views use fixed labels and indentation, while status is
  pretty-printed JSON. Exact human labels and geometry are deferred; semantic
  fields and complete machine data remain master behavior.

Sources: `src/diff.js`, `src/cli.js`, and `test/cli.test.js`.

### Pager interaction

- `--pager` sends final rendered bytes to `PAGER` or `less` through a shell with
  piped input and inherited output. Pager exit status is returned and failure is
  loud.
- No deterministic PTY fixture currently proves pager selection, exact bytes,
  exit view, resize behavior, cursor behavior, focus, cleanup, or restoration.
- Whether paging should be TTY-gated, which less flags are intended, and how
  resize/state restoration should work remain future UI decisions. The trusted
  shell boundary behind `PAGER` is retained in master security.

Sources: `src/blueprint.js` and README pager documentation.

### Documentation imagery

- README links `assets/seed-banner.png`, a 1774x887 RGB PNG introduced as
  documentation presentation. There is no screenshot comparator or approval
  workflow for it.

Sources: `README.md`, `assets/seed-banner.png`, history commit `709add6`.

## Current visual evidence and gaps

Existing tests assert Markdown hierarchy, ANSI enablement and preservation,
plain output, requirement warnings, line windows, table wrapping, diff fragments,
and large piped-output completion. The repository has no approved terminal-frame
goldens, screenshots, exact cell-grid reconstruction, deterministic PTY/pager
harness, visual diff artifacts, mutation proof, or baseline approval/update
workflow. Those absences do not block master.

## UI genome classification

All entries below are `UiDeferred`, never master or polish work for this Seed.

| Genome or family | Current relation | Deferred reason |
| --- | --- | --- |
| `cli-color-output`, `cli-no-color` | ANSI and plain modes exist | Palette, detection presentation, and style acceptance are visual. Master separately preserves ANSI-free semantic accessibility without adopting either UI genome. |
| `cli-table-output` | Genome listing uses a wrapped table | Geometry, column allocation, and wrapping are visual. |
| `cli-progress-output` | Some status/report labels resemble progress | No stable progress interaction contract exists. |
| `ui-visual-regression` | Deterministic rendering exists in parts | No approved frames, comparator, visual diffs, mutation proof, or baseline workflow. |
| `ui-interaction` | Pager is the only interactive adapter | No complete interaction, focus, keyboard, or cleanup contract exists. |
| `ui-responsive` | `COLUMNS` affects table wrapping | No named breakpoints, approved frames, adversarial fixtures, resize behavior, or restoration tests exist. |
| `ui-human-acceptance` | Output is intended for people | No recorded human acceptance protocol or approved visual states exists. |
| `tui-visual-regression` | Terminal output is relevant | Seed is not a full-screen TUI and has no cell-grid goldens. |
| `cli-tui`, `tui-client`, and all `tui-*` implementation genomes | Terminal is the host surface | Current product is a conventional CLI, not a persistent full-screen TUI framework application. |

The later UI Seed should own blueprint hierarchy and labels, exact warning and
diff frames, table geometry, ANSI matrix, pager behavior, responsive PTY states,
approved documentation imagery, and visual regression evidence.

## Near-fit non-UI genomes for later polish review

These are `PolishCandidate`, not active obligations. Each fails at least one
material address or lacks evidence for the full genome.

| Genome | Existing fit | Why excluded from master |
| --- | --- | --- |
| `cli-nodejs` full genome | Node CLI, npm install, and Linux use are established | No declared Node 20 floor; no secret-redaction layer proves `no-secret-output`. Master uses a coherent subset only. |
| `cli-help-version` | Global `--help` and `-h` succeed | `--version` is absent and currently fails as an unknown command. |
| `architecture-modular-monolith` | One package/bin and acyclic CommonJS import graph | Controlled public/private module boundaries and bypass checks are not explicit contract evidence. |
| `verify-smoke-tests` | Tests and CLI workflows exist | No distinct fast smoke command is exposed for a clean checkout. |
| `policy-safe-paths` | Names and evidence paths reject absolute/traversal forms | Evidence containment is not symlink-sensitive; user genome and skill destinations are intentional external paths. |
| `policy-no-shell-injection` | Most filesystem/CLI execution uses structured APIs | Proof commands and `PAGER` are intentionally trusted shell strings. |
| `policy-no-secrets-output` | Secret output is not intended | No redaction/filter layer exists; reports can show commands and bounded stdout/stderr. |
| `policy-repo-local-files` | Contract, state, repo genomes, and evidence are repository-rooted | User genomes and explicit Codex/Claude skill installation are documented external exceptions. |
| `policy-input-validation` | Most CLI, YAML, path, reference, and state inputs fail before mutation | Genome listing converts malformed descriptions to blank text and Seed listing skips unsafe directory names rather than failing universally. |
| `obs-clear-errors` | Parser, validator, reference, state, and command failures are actionable | Genome-list parse errors can degrade to blank descriptions, conflicting with a universal fail-loud claim. |
| `repo-dependency-lock` | `package-lock.json` is tracked and clean installs are deterministic | No CI gate proves frozen-install lock drift blocks integration. |
| `repo-license` | `LICENSE`, `package.json`, and root lockfile metadata consistently select MIT | The genome also covers all documentation and source notices, but those are not license-declaration surfaces today. Master states the narrower as-built license contract locally. |

Additional non-fit policies are deliberately not candidates: `policy-no-external-dependencies`
is false because `yaml` and `cli-highlight` are runtime dependencies, and a
universal no-shell policy contradicts the trusted proof-command and pager interfaces.

## Scoped observations for later ownership decisions

- Explicit `--color` can force ANSI when redirected although automatic output is
  plain; automatic diff coloring does not honor the full Markdown detection matrix.
- README documents `--head` more clearly than `--tail`; both exist.
- Offset and limit apply independently per selected blueprint section.
- JSON blueprint output can be preceded by validation warning text for a
  warning-bearing Seed, so byte-pure JSON under warnings is not established.
- Repeated `--repo`, owner, evidence, and reason flags are last-wins, while
  duplicate `--seed` and conflicting color flags fail.
- Verification sync does not provide one transaction spanning snapshot,
  dependency snapshot, and session replacement; only the session JSON replacement
  is atomic. No stronger crash-recovery claim enters master.
- External dependency drift is informational for this selected Seed and does not
  expire evidence or create source-Seed work.
