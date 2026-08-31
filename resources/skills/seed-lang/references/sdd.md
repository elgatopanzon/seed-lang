# Standalone Seed Driven Development

Use this procedure to implement or change working software from `seed/seed.yml`
without assuming any external orchestrator, runner, reviewer, task graph, or
agent platform. The implementing agent owns work selection, implementation,
evidence, verification, and completion.

## Preconditions

1. Confirm the `seed` command is available.
2. Confirm the repository contains `seed/seed.yml`. If it does not, author an
   implementation-ready Seed before implementation.
3. Choose one stable owner string for every `seed verify` claim and transition.
4. Do not assume a persistent-goal feature exists. If one is available, use it
   only for persistence; Seed remains the work and completion authority.

## Inspect Before Editing

Run:

```text
seed validate
seed blueprint --section global-policies
seed blueprint
seed verify status
```

If status reports that no verification session exists, run `seed verify start`
before changing implementation files. If a session exists, preserve it. Do not
reset for normal incremental work. Then run:

```text
seed verify pending
```

For a changed Seed, additionally run:

```text
seed blueprint diff --no-color
seed diff --no-color
```

Read every modified address, referenced address, artifact, and active global
policy. `seed blueprint diff` is the primary implementation-facing change view
because it includes genome expansion.

## Select Work

Use `seed verify pending` and the blueprint to choose the next smallest coherent
vertical behavior slice. Prefer behavior users can exercise over disconnected
scaffolding. Keep the selected addresses, affected files, and focused proof
clear. Split work locally when independent slices exist; no task graph is
required.

If the Seed is ambiguous, contradictory, or missing a product decision, stop and
request that decision. Do not infer a contract from existing implementation.

## Implement

1. Change the Seed first when the desired observable contract changes.
2. Validate the Seed and inspect the constructed blueprint diff.
3. Implement only the selected contract slice and preserve repository design.
4. Add focused automated proof for changed behavior where practical.
5. Exercise a real CLI, API, UI, service, file, or integration path for
   user-facing behavior.
6. Run the narrow relevant regression set. Run the full suite for shared or broad
   changes.

## Record Evidence

Claim exactly one item:

```text
seed verify next --owner OWNER
```

Inspect its addresses, artifacts, method, evidence requirements, and global
policies. Run focused proof that would fail if that item were broken.

Confirm a passing item with the same owner, at least one repository-relative
implementation file, at least one executable test command, and item-specific
evidence:

```text
seed verify confirm ITEM --owner OWNER --file PATH --test-cmd "COMMAND" --evidence "ITEM-SPECIFIC RESULT"
```

Record a terminal failure only when the implementation will remain unsatisfied:

```text
seed verify fail ITEM --owner OWNER --file PATH --test-cmd "FAILING COMMAND" --reason "ITEM-SPECIFIC FAILURE"
```

Do not record `fail` merely as an intermediate debugging state. A failed item is
terminal for the current session. Fix in-scope defects and obtain passing proof
before confirming; use failure when handing back an unsatisfied implementation.

Repeat until `seed verify next --owner OWNER` prints exactly:

```text
No pending verification items.
```

Do not bulk-confirm items. Do not reuse a broad whole-suite command as sole proof
for unrelated claims. Each command must directly support its item.

## Explicit SDD Injection

Use this speed-focused mode only when the operator directly asks for `SDD
injection`. Never infer it from an ordinary SDD request, time pressure, or an
existing verification backlog.

1. Preserve the current session and inspect its status before editing. Stop if it
   already contains unrelated pending, failed, blocked, or review work that the
   requested change cannot honestly resolve.
2. Change the Seed first, validate it, and inspect the complete Blueprint diff.
   Identify the exact new or modified addresses and their affected evidence.
3. Implement only that delta. Directly evaluate the changed behavior with the
   smallest relevant commands or live checks needed to know what passed and what
   failed. Do not run the full suite merely to satisfy the ordinary SDD gate.
4. Claim each new or expired item caused by the changed addresses or owned files.
   Inject the exact known results without making Seed execute them again:

```text
seed verify inject ITEM --owner OWNER --file PATH \
  --authorization operator-requested-sdd-injection \
  --pass-cmd "FOCUSED COMMAND" \
  --evidence "ITEM-SPECIFIC OBSERVED RESULT"
```

Use `--fail-cmd` and `--reason` when any known command failed. Passing and failing
attestations may be combined. Never inject a guessed, inherited, generic, or
unobserved result. Use `inject`, not `confirm` or `fail`, so the ledger never
misrepresents attestation as CLI-executed proof.

The authorization acknowledgement is permitted only inside a directly requested
`SDD injection` run. Never copy, infer, or supply it during strict SDD, ordinary
verification, evidence refresh, final acceptance, or an unrequested recovery.
The CLI rejects missing or incorrect authorization before changing session state.

Do not run `seed verify check` during the injection run. Run `seed verify audit`,
`seed verify report`, and `seed verify status`; these inspect state without
executing the injected command strings. Require zero unrelated work and truthful
injected counts. A passing injection run may sync a satisfied session. A failed
attestation must remain failed and unsatisfied. Report the injected item count,
the focused evaluations actually performed, and the skipped full-verification
limitation.

A later strict SDD run may execute `seed verify check`; it replaces injected
attestations with ordinary executable command results.

## Expired Evidence

Use `seed verify status` to distinguish:

- Evidence-file expiry: cited implementation files changed.
- Seed-address expiry: an item's own or referenced contract address changed.
- Mixed expiry: both require fresh semantic review.

For a queue containing only evidence-file expiry with an unchanged Seed and no
new, active, failed, or blocked work, automation may run:

```text
seed verify refresh-expired --owner OWNER --json
```

This executes each unique stored proof once and updates evidence atomically only
if every proof passes. It refuses semantic contract changes and must not replace
review of modified Seed addresses.

## Evidence Link Audit And Repair

Inspect `seed verify audit` and `seed verify report` for advisory warnings about
high evidence-file fanout, repeated evidence bundles, or proof commands shared
across many address families. These warnings identify review candidates; they do
not prove that a linkage is semantically wrong.

If the stored file ownership is wrong, reopen exact terminal items without
resetting unrelated session progress:

```text
seed verify reopen ITEM --owner OWNER --reason "ITEM-SPECIFIC REPAIR"
```

For one high-fanout file, preview the matching terminal items first:

```text
seed verify reopen --evidence-file PATH --owner OWNER --reason "REPAIR PURPOSE"
```

Review every listed ID, then add `--apply` to reopen that exact current batch.
Applied reopen preserves prior terminal evidence in `reopen_history` and claims
the selected items. Run focused proof and use `confirm` or `fail` with narrow
replacement files. Use `refresh-expired` when existing linkage remains correct;
use `reopen` only when ownership itself needs repair. Never edit generated
session state or treat reopen as proof.

## Completion Gate

After the queue is exhausted, run in order:

```text
seed verify check
seed verify audit
seed verify report
seed verify status
```

`seed verify check` deduplicates identical recorded command strings, runs each
unique command once, and fans the result back to every referencing item.

Completion requires:

- Audit reports zero errors.
- `pending`, `claimed`, `failed`, `blocked`, `needs_review`, and `expired` are all
  zero.
- `completed` is `true`.
- `satisfied` is `true`.
- Important user-facing paths have real executable proof.

Then run:

```text
seed verify sync
```

Sync promotes the current compiled Seed to the verification snapshot while
preserving valid evidence. Report exact commands, results, warnings, limitations,
and final status. Do not claim completion if any gate remains unsatisfied.
