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
