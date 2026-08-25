# Seed Commands

Put the global repository option before the command. Add `--seed NAME` to any
command to select `seed/NAME/seed.yml` and `.seed/NAME` state:

```text
seed --repo PATH COMMAND
seed validate --seed ui
```

## Contract And Blueprint

```text
seed init [--overwrite] [--genome ID] [--genomes ID[,ID...]]
seed list
seed validate
seed diff [--no-color]
seed blueprint [--json] [--color | --no-color] [--section ID] [--filter @ADDRESS]
               [--limit N] [--offset N] [--head N] [--tail N] [--pager]
seed blueprint diff [--no-color]
```

`blueprint diff` compares the previous verification snapshot and current fully
constructed blueprints, including genomes. `diff` shows lower-level compiled
YAML changes.

`list` reports each discovered contract: `master` for `seed/seed.yml`, then
named Seeds found at `seed/NAME/seed.yml`.

Named Seeds may reference compiled addresses, including artifacts, with
`@SEED:ADDRESS`. The provenance-qualified form
`@SEED:genome/GENOME:ADDRESS` requires the source address to come from that
genome. Blueprints resolve and annotate these dependencies; Seed and Blueprint
diffs report changes since the selected Seed's verification snapshot without
adding source-Seed verification work.

## Genomes

```text
seed genome list [--builtin] [--user] [--repo]
seed genome init NAME [--overwrite]
seed genome validate [--builtin] [--user] [--repo]
seed genome blueprint NAME [--json] [--color | --no-color] [--section ID] [--filter @ADDRESS]
                           [--limit N] [--offset N] [--head N] [--tail N]
                           [--pager]
```

## Verification Session

```text
seed verify start
seed verify reset
seed verify sync
seed verify pending
seed verify next [--owner OWNER]
seed verify claim ITEM [--owner OWNER]
seed verify confirm ITEM --owner OWNER --file PATH [--file PATH...]
                    --test-cmd COMMAND [--test-cmd COMMAND...] [--evidence TEXT]
seed verify fail ITEM --owner OWNER --file PATH [--file PATH...]
                 --test-cmd COMMAND [--test-cmd COMMAND...] [--reason TEXT]
seed verify check
seed verify refresh-expired --owner OWNER [--json]
seed verify audit
seed verify report
seed verify status
```

- `start` creates a session and compiled Seed snapshot.
- `reset` intentionally discards session progress for a full rerun. Do not use it
  for normal incremental changes.
- `pending` reads pending and expired work without claiming it.
- `next` claims the next pending or expired item.
- `confirm` executes every supplied command and succeeds only when all pass.
- `fail` executes every supplied command and succeeds only when at least one
  fails.
- `check` executes each unique recorded command once and applies the result to
  every occurrence.
- `refresh-expired` is a strict atomic fast path only for unchanged-contract,
  evidence-file-only expiry.
- `audit` evaluates completeness and evidence quality.
- `report` renders status, audit findings, items, files, commands, and evidence.
- `status` emits machine-readable aggregate and expiry details.
- `sync` promotes a satisfied current Seed snapshot while preserving valid
  evidence.

## Skill Installation

```text
seed install-skill --codex
seed install-skill --claude
```

Exactly one target is required. Codex installs to
`${CODEX_HOME:-$HOME/.codex}/skills/seed-lang`. Claude installs to
`${CLAUDE_HOME:-$HOME/.claude}/skills/seed-lang`. Installation replaces only the
existing `seed-lang` skill directory and does so atomically.
