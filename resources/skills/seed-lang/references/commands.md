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
seed genome search QUERY [--full-text] [--builtin] [--user] [--repo]
seed genome init NAME [--overwrite]
seed genome validate [--builtin] [--user] [--repo]
seed genome blueprint NAME [--json] [--color | --no-color] [--section ID] [--filter @ADDRESS]
                           [--limit N] [--offset N] [--head N] [--tail N]
                           [--pager]
```

`search` uses case-insensitive substring matching over genome IDs, metadata
names and descriptions, tags, and direct authored address names. `--full-text`
also searches scalar values inside direct authored addresses. Results include
the genome origin, tags, match types, and matching addresses. Origin flags
restrict the searched definitions.

## Verification Session

```text
seed verify start
seed verify reset
seed verify sync
seed verify pending
seed verify next [--owner OWNER]
seed verify claim ITEM [--owner OWNER]
seed verify reopen ITEM [ITEM...] --owner OWNER --reason TEXT
seed verify reopen --evidence-file PATH --owner OWNER --reason TEXT [--apply]
seed verify confirm ITEM --owner OWNER --file PATH [--file PATH...]
                    --test-cmd COMMAND [--test-cmd COMMAND...] [--evidence TEXT]
seed verify fail ITEM --owner OWNER --file PATH [--file PATH...]
                 --test-cmd COMMAND [--test-cmd COMMAND...] [--reason TEXT]
seed verify inject ITEM --owner OWNER
                   --authorization operator-requested-sdd-injection
                   --file PATH [--file PATH...]
                   (--pass-cmd COMMAND | --fail-cmd COMMAND)...
                   (--evidence TEXT | --reason TEXT)
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
- `reopen` preserves prior terminal evidence in `reopen_history` and claims exact
  items for focused replacement proof. Evidence-file selection previews matching
  terminal items without mutation; `--apply` is required to reopen that batch.
- `confirm` executes each command once per product-content revision, reuses the
  complete producer result for later consumers, and succeeds only when all pass.
  A failed confirmation remains claimed and atomically retains complete command
  diagnostics in the session while also reporting them to the caller. Failed
  results are never reused; an explicit retry executes them again, while rejected
  attempt diagnostics remain in `test_command_attempts` after a later success.
- `fail` uses the same content-bound producer results and succeeds only when at
  least one fails.
- `inject` does not execute commands. It stores explicit per-command pass/fail
  attestations with owner, timestamp, revision, file hashes, address fingerprints,
  and visible injected provenance. It is reserved for operator-requested SDD
  injection runs and rejects missing or incorrect authorization before changing
  session state. Supply the exact authorization acknowledgement only after the
  operator directly requests `SDD injection`.
- `check` executes each unique recorded command once, reports one item-owned
  producer and warm results for the remaining occurrences, and replaces injected
  attestations with executable results.
- `refresh-expired` is a strict atomic fast path only for unchanged-contract,
  evidence-file-only expiry.
- `audit` evaluates completeness and evidence quality, including advisory
  warnings for high evidence-file fanout, repeated evidence bundles, and proof
  commands coupled across many address families.
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
