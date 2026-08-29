![Seed banner](assets/seed-banner.png)

# Seed

Seed is a contract language and CLI for specifying bounded software behavior as
an authoritative implementation brief.

A Seed contract describes what a project must do, what it must not do, which
artifacts define its external contracts, what implementation choices remain
free, and what evidence proves completion. An implementation agent works from
that contract and records executable evidence against every requirement.

Seed Driven Development, or SDD, uses this loop:

1. Change the Seed contract first.
2. Inspect the fully constructed contract diff.
3. Implement the smallest coherent change.
4. Verify every affected contract item with focused evidence.
5. Require the complete Seed to be satisfied before finishing.

Seed is designed to work directly with a capable coding agent. It does not
require a particular model, framework, editor, agent runtime, task graph, or
orchestration system.

> Seed is currently a prototype. The package is private and is not published to
> a package registry.

## Human Quick Start

This is the recommended human-led workflow. You provide the product intent and
make product decisions. The agent translates that intent into a Seed contract,
implements from the contract, and proves the result against it.

> **Important:** Do not introduce Seed into an existing repository that was
> built without a Seed contract. Reconstructing authoritative product intent
> from an already-constructed implementation is much less reliable than
> starting a fresh project with Seed. This warning does not apply to an existing
> project that already has a maintained `seed/seed.yml`; use the contract-first
> change workflow for those projects.

### 1. Install Seed And The Agent Skill

Install the `seed` CLI, then install the skill for your agent:

```sh
npm install -g /path/to/seed-lang
seed install-skill --codex
```

For Claude, use `seed install-skill --claude` instead.

Start or restart the agent after installing the skill so it discovers the new
instructions. Before beginning a project, ask it to verify both dependencies:

```text
Verify that you can run the seed binary from PATH and that you can access the
seed-lang skill. Report any installation problem before continuing.
```

The agent should be able to run `seed --help` successfully. Do not begin
planning until both the CLI and skill are available.

### 2. Plan The Project Into Seed

Launch the agent inside the project directory. This may be a fresh, empty
directory. Explain what you want the finished software to do as a black box:
describe its users, inputs, outputs, behavior, constraints, failure behavior,
and any externally visible interfaces. You do not need to prescribe its
internal implementation unless an implementation choice is itself a
requirement.

You must know what product you want to build. Seed planning can expose missing
decisions and contradictions, but it cannot choose product intent on your
behalf.

Ask the agent:

```text
Use the seed-lang skill to plan this project as a complete, implementation-ready
Seed contract. Ask me about product decisions that cannot be inferred safely.
Run the Seed readiness check, create any missing artifacts, and do not finish
planning until the Seed is valid and ready to implement.
```

Answer questions in terms of required observable behavior. Review the resulting
`seed/seed.yml`, its artifacts, and `seed blueprint`. Planning is complete when
the agent reports that the contract is valid, internally consistent, and
implementation-ready.

### Optional: Approve UI Artifacts Before Implementation

If the project has a web, desktop, mobile, terminal, or other visual interface,
review its UI artifacts after planning and before implementation. These may
include annotated wireframes, screen references, navigation flows, responsive
states, terminal cell frames, interaction scenarios, fixtures, or approved
goldens.

UI intent is difficult to express completely in prose. It is also the area most
likely to require experimentation before the Seed accurately represents what
you want. Ask the agent to create or refine concrete artifacts, render or
prototype alternatives when useful, and let you approve the intended screens
and interactions.

```text
This project has a user interface. Use the seed-lang skill to review the Seed's
UI requirements and artifacts before implementation. Create any missing screen,
navigation, responsive-state, interaction, fixture, or golden artifacts needed
to make the intended UI independently implementable and verifiable. Experiment
with alternatives where the visual intent is unclear, ask me to approve major
screens and flows, then update the Seed to reference the approved artifacts.
Do not begin implementation until the UI contract is ready.
```

An implementation-generated screenshot should not automatically become the
design authority. Major visual references and golden changes require explicit
human approval. If implementation later reveals a better design, update and
approve the UI artifacts and Seed first, then reimplement from the changed
contract.

### 3. Implement With Seed Driven Development

Once planning is complete, start a persistent implementation task. `/goal` is
one option, but any agent mode that can reliably continue a long-running task is
suitable.

Ask the agent:

```text
Use the seed-lang skill and implement this project from seed/seed.yml using
Seed Driven Development. Treat the Seed as authoritative. Continue until every
contract item has focused executable evidence, seed verify audit has zero
errors, and seed verify status reports completed: true, satisfied: true,
expired: 0, and failed: 0. Then run seed verify sync.
```

Implementation may take longer and use more tokens than direct prompt-driven
coding. The intended result is bounded by the complete contract and verified
without requiring you to steer ordinary implementation decisions.

#### Start A Fresh Implementation With `/goal`

From the project directory:

```text
/goal Use the seed-lang skill. Implement this project from seed/seed.yml using
Seed Driven Development. Treat the Seed and its referenced artifacts as
authoritative. Continue through implementation and focused executable evidence
until seed verify audit has zero errors and seed verify status reports
completed: true, satisfied: true, expired: 0, and failed: 0. Run seed verify
sync only after those conditions pass. Stop and ask me only when a genuine
product decision, approval, credential, or external access block requires human
input.
```

#### Reimplement A Changed Contract With `/goal`

Use this after changing an existing project's Seed:

```text
/goal Use the seed-lang skill. The authoritative Seed contract has changed.
Validate it, inspect seed blueprint diff --no-color, and reimplement the project
using Seed Driven Development so the implementation matches the complete
current blueprint. Reverify every new or expired item with focused executable
evidence. Continue until seed verify audit has zero errors and seed verify
status reports completed: true, satisfied: true, expired: 0, and failed: 0.
Then run seed verify sync. Do not preserve implementation behavior that
contradicts the updated Seed.
```

#### Claude Code Ultracode

Start a fresh implementation with this prompt:

```text
Use the seed-lang skill and work persistently until completion. Implement this
project from seed/seed.yml using Seed Driven Development. Treat the Seed and its
referenced artifacts as authoritative. Produce focused executable evidence for
every contract item. Finish only when seed verify audit has zero errors and
seed verify status reports completed: true, satisfied: true, expired: 0, and
failed: 0, then run seed verify sync. Ask me only for genuine human-required
product decisions, approvals, credentials, or external access.
```

After a Seed contract change, use:

```text
Use the seed-lang skill and work persistently until completion. The Seed
contract has changed. Validate it, inspect seed blueprint diff --no-color, and
reimplement the project from the complete current blueprint using Seed Driven
Development. Reverify all new and expired items. Finish only when seed verify
audit has zero errors and seed verify status reports completed: true,
satisfied: true, expired: 0, and failed: 0, then run seed verify sync. Do not
patch around or contradict the changed contract.
```

#### Codex Ultra

Start a fresh implementation with this prompt:

```text
Use the seed-lang skill. Implement this project from seed/seed.yml using Seed
Driven Development and continue autonomously until the complete contract is
implemented. Treat the Seed and its referenced artifacts as authoritative.
Record focused executable evidence for every item. Finish only when seed verify
audit has zero errors and seed verify status reports completed: true,
satisfied: true, expired: 0, and failed: 0, then run seed verify sync. Request
input only for genuine human-required product decisions, approvals, credentials,
or external access.
```

After a Seed contract change, use:

```text
Use the seed-lang skill. The authoritative Seed has changed. Validate it,
inspect seed blueprint diff --no-color, and reimplement the project from the
complete current blueprint using Seed Driven Development. Reverify every new or
expired contract item with focused executable evidence. Finish only when seed
verify audit has zero errors and seed verify status reports completed: true,
satisfied: true, expired: 0, and failed: 0, then run seed verify sync. Do not
make code-only adjustments that leave the implementation out of sync with Seed.
```

### 4. Watch For Blocks And Human Decisions

You do not need to direct each coding step, but you should watch the agent's
output or return when it requests input. Human interaction is required when the
agent encounters a genuine product ambiguity, contradictory requirements,
missing access or credentials, an external dependency it cannot reach, or a
decision outside the Seed's declared freedoms.

When blocked, answer the product question or provide the missing access. Do not
tell the agent to guess silently. After resolving a requirement-level block,
have it record the decision in Seed before implementation continues.

### 5. Judge The Result Against Your Intent

When `seed verify status` reports the project fully completed and satisfied,
use the software yourself and ask one question:

> Does the produced project match the specification I intended?

If yes, the Seed, implementation, and verification evidence describe the same
accepted project.

If not, do **not** ask the agent to directly patch or implement the desired
change. A direct code fix would allow the implementation and its authoritative
contract to drift apart. Always correct the contract first:

```text
The produced project does not match my intent in the following ways: [describe
the observable differences]. Use the seed-lang skill to update the Seed and any
required artifacts first. Show me the constructed blueprint diff. Then resume
implementation using Seed Driven Development and continue until the updated
Seed is completely verified and satisfied.
```

Repeat this contract-first loop for every product adjustment:

```text
human intent -> Seed update -> blueprint diff -> SDD implementation -> evidence
```

Never make an intentional product change only in code. Keeping Seed ahead of
implementation ensures the contract remains a usable specification of the
project that actually exists.

## Why Seed

Ordinary natural-language implementation prompts tend to mix product behavior,
architecture suggestions, temporary planning, and acceptance criteria. Important
requirements become implicit, and the final test suite may prove only what the
implementation happened to build.

Seed separates those concerns:

- `seed/seed.yml` is the product contract.
- Genomes add reusable contract fragments without selecting a framework unless
  the genome explicitly represents one.
- Artifacts hold schemas, examples, fixtures, external contracts, and goldens.
- Blueprints expand the complete contract into a model-facing implementation
  brief.
- Verification items define acceptance methods and required evidence.
- `.seed` records the verification snapshot, claims, results, commands, and file
  hashes.
- Changed contracts or evidence files expire affected verification rather than
  silently preserving stale confidence.

The goal is not to spend fewer tokens or produce code as quickly as possible.
The goal is to produce software that remains inside a declared contract without
requiring continuous human steering.

## Requirements

- Node.js with npm.
- A local project repository.
- A coding agent with shell and filesystem access if using automated SDD.

## Install From This Repository

```sh
git clone https://github.com/elgatopanzon/seed-lang.git
cd seed-lang
npm install
npm install -g .
seed --help
```

The CLI executable is `seed`.

## Install The Agent Skill

Seed ships a portable `seed-lang` skill containing contract authoring guidance,
the current command reference, a readiness check, and standalone SDD
implementation instructions.

For Codex:

```sh
seed install-skill --codex
```

This installs to:

```text
${CODEX_HOME:-$HOME/.codex}/skills/seed-lang
```

For Claude:

```sh
seed install-skill --claude
```

This installs to:

```text
${CLAUDE_HOME:-$HOME/.claude}/skills/seed-lang
```

Exactly one target must be selected. Installation atomically replaces only the
existing `seed-lang` skill directory. The Codex variant includes
`agents/openai.yaml`; the Claude variant omits that Codex-specific UI metadata.

## Quick Start

Create a contract in the target project:

```sh
cd /path/to/project
seed init
```

Or initialize with one or more built-in genomes:

```sh
seed init --genome cli-nodejs
seed init --genomes cli-nodejs,cli-human-output,repo-readme
```

This creates:

```text
seed/
├── seed.yml
└── scripts/
```

Edit `seed/seed.yml`, then validate and inspect it:

```sh
seed validate
seed blueprint
seed blueprint --section global-policies
seed blueprint --section verification-plan
```

Before implementation, start a verification session:

```sh
seed verify start
seed verify pending
```

Then tell a persistent coding agent:

```text
Use the seed-lang skill. Implement this project from seed/seed.yml using
standalone Seed Driven Development. Continue until seed verify audit has zero
errors, seed verify status reports completed: true, satisfied: true, expired: 0,
and failed: 0, then run seed verify sync.
```

The skill provides the complete direct workflow. A persistent `/goal`-style mode
is useful for long implementations, but persistence is not part of the Seed
contract and is not required by the CLI.

## Seed Contract Structure

Seed files are YAML. The main sections are:

| Section | Purpose |
| --- | --- |
| `metadata` | Project name and summary. |
| `genomes` | Reusable contract fragments composed before local values. |
| `requirements` | Temporary inbox of raw requirements that still need conversion into the contract. |
| `scope` | Included and excluded boundaries. |
| `artifacts` | Schemas, fixtures, samples, goldens, and external contracts. |
| `interfaces` | CLI, API, UI, file, automation, and integration surfaces. |
| `behavior` | Required functional and output behavior. |
| `errors` | Failure conditions, visible errors, and remediation. |
| `state` | Persistence, consistency, retention, and migration semantics. |
| `security` | Trust, authorization, secrets, and access boundaries. |
| `environment` | Runtime, platform, dependency, and deployment assumptions. |
| `observability` | Diagnostics, logs, health, metrics, and audit behavior. |
| `compatibility` | Stability and migration promises. |
| `constraints` | Binding implementation or non-functional requirements. |
| `freedom` | Explicit implementation choices left open. |
| `verifications` | Acceptance methods and required evidence. |

### Requirements Inbox

Use `requirements` to capture raw intent before it has been sorted into the
contract. It accepts a simple string list or a nested object with string leaves:

```yaml
requirements:
  - Print an ASCII cat full screen.
  - Exit cleanly on q.
```

```yaml
requirements:
  tui:
    - Render as a real full-screen terminal application.
    - Restore the terminal on exit.
  data:
    public-api: Use a documented public API for catalog records.
```

Requirements are planning TODOs, not implementation-ready contract items.
`seed validate` fails and a verification session cannot start while any remain.
Convert each requirement into the appropriate addressable sections and
verifications, create and attach any missing artifacts, then remove the
converted requirement. An absent or empty `requirements` container is valid.

Blueprint and diff views remain available during conversion. They place a
prominent not-ready warning and the complete unresolved requirements list above
their normal output. JSON blueprints expose `requirementsReady`,
`requirementsWarning`, and the same flattened list as `requirements`.

Most sections are addressable. Tree keys form addresses:

```yaml
constraints:
  no-network:
    description: Must not make outbound network calls.
    policy: global
```

This item is addressed as `constraints.no-network` and referenced as
`@constraints.no-network`.

Security items default to global policy. Other items may declare
`policy: global` when they apply during every implementation and verification
step. Ordinary items are local by default.

### Artifacts

Use artifacts when prose is insufficient to implement or verify a requirement:

```yaml
artifacts:
  import-schema:
    path: seed/artifacts/import.schema.json
    description: Canonical schema for imported records.

behavior:
  record-import:
    description: Import records matching @import-schema.
    artifacts:
      - import-schema
```

Any item mentioning an artifact must list that artifact ID in its `artifacts:`
field.

External APIs, protocols, standards, schemas, and file formats should be
represented by concise repository-local artifacts containing the required
contract subset, authoritative source URL, version or revision, and access date.
A mutable website alone is not a stable implementation brief.

## Genomes

Genomes are reusable Seed fragments. They can describe runtimes, interfaces,
architecture boundaries, verification policies, repository quality, UI behavior,
packaging, storage, and other recurring contracts.

List and inspect them:

```sh
seed genome list
seed genome list --builtin
seed genome blueprint cli-nodejs
seed genome blueprint repo-open-source-ready --section global-policies
seed genome validate --builtin
```

Genome precedence, lowest to highest:

1. Built-ins packaged with Seed.
2. User genomes in `~/.seed/genomes/`.
3. Repository genomes in `seed/genomes/`.
4. Local values in `seed/seed.yml`.

Create a repository genome:

```sh
seed genome init project-conventions
seed genome validate --repo
```

### Composition And Filtering

```yaml
genomes:
  - cli-nodejs
  - cli-human-output
  - !cli-single-command
  - cli-nodejs[constraints]
  - starter-local-safe[!*no-network*]
  - monorepo-api-web[interfaces,!*http*]
```

- `!genome-id` removes that genome everywhere in the composed graph, including
  transitive composition.
- Bracket selectors import sections or addresses.
- Bracket entries beginning with `!` remove matching addresses after
  composition.
- Multiple filters may be comma-separated.
- Unknown genomes and unmatched complete-genome exclusions fail loudly.

## Blueprints And Diffs

`seed blueprint` renders the complete model-facing contract after genome
composition as a traditional Markdown specification. Main contract sections use
second-level headings, address segments become progressively nested headings,
and every item retains its exact address and provenance. Parent entries do not
repeat content rendered by their child addresses. Global policies remain near
the top. When the requirements inbox is populated, a not-ready warning and all
unresolved requirements appear before the blueprint.

Useful views:

```sh
seed blueprint
seed blueprint --color
seed blueprint --no-color
seed blueprint --json
seed blueprint --section interfaces
seed blueprint --section verification-plan
seed blueprint --filter @behavior.outputs
seed blueprint --head 100
seed blueprint --pager
```

Markdown blueprint output is syntax-colored when written to an interactive
terminal. Pipes and redirected output remain plain Markdown. Use `--color` to
force ANSI color or `--no-color` to disable it; `NO_COLOR` and `TERM=dumb` are
honored by automatic mode.

After a verification session exists, compare the current Seed with its stored
snapshot:

```sh
seed blueprint diff --no-color
seed diff --no-color
```

- `blueprint diff` compares fully constructed old and new blueprints, including
  genome-provided behavior. This is the primary implementation-facing diff.
- `diff` compares lower-level compiled YAML and is useful for structural
  diagnostics.

## Standalone Seed Driven Development

For a new implementation:

1. Author and validate an implementation-ready `seed/seed.yml`.
2. Read the complete blueprint, global policies, artifacts, and verification
   plan.
3. Run `seed verify start` before changing implementation files.
4. Select the smallest coherent behavior slice from the blueprint and pending
   queue.
5. Implement the slice and exercise a real user-facing path where applicable.
6. Claim and verify each item with focused executable evidence.
7. Exhaust the queue and run the completion gate.
8. Sync the satisfied Seed snapshot.

For a behavior change to an existing implementation:

1. Update the Seed contract first.
2. Run `seed validate`.
3. Inspect `seed blueprint diff --no-color`.
4. Implement only the affected contract slice.
5. Reverify new and expired items.
6. Run the completion gate and sync.

If the Seed is ambiguous, contradictory, or missing an implementation-critical
artifact, stop and resolve the contract. Existing code is not allowed to invent
the missing product requirement retroactively.

## Verification

Seed verification is a repository-local evidence ledger backed by executable
commands and file hashes.

### Start And Inspect

```sh
seed verify start
seed verify status
seed verify pending
```

`start` creates a compiled Seed snapshot and a session under `.seed`. Preserve
the session during normal incremental work. `reset` intentionally discards
session progress and is only for a deliberate full rerun.

### Claim One Item

Use one stable owner string throughout the session:

```sh
seed verify next --owner codex
```

Or claim a specific item:

```sh
seed verify claim ITEM_ID --owner codex
```

The claim output includes the item's address, method, required evidence,
referenced artifacts, and active global policies.

### Confirm Passing Evidence

```sh
seed verify confirm ITEM_ID \
  --owner codex \
  --file src/feature.js \
  --file test/feature.test.js \
  --test-cmd "node --test test/feature.test.js" \
  --evidence "ITEM_ID exercised the production path and passed its focused test"
```

Every confirmation requires:

- The same owner that holds the claim.
- At least one repository-relative evidence file.
- At least one executable test command.
- Item-specific evidence.

Commands execute from the repository root. The first occurrence of a command
produces a content-bound result; later items at the same product revision reuse
that complete stdout, stderr, exit-status, and timing record without executing
the command again. Producer and consumer records identify the owning item and
exclude `.seed` state from the revision. A command that changes product content
fails instead of caching stale evidence. Confirmation succeeds only when every
supplied or reused result passed.

If confirmation fails, the item remains claimed and the complete attempted
results are written atomically to the session. The CLI reports each failed
command's exit status, signal, timeout state, stdout, and stderr. Failed results
are diagnostic records, never reusable producers: the next explicit transition
executes the command again even when product content is unchanged. Rejected
transition attempts remain available in `test_command_attempts` after a later
successful retry replaces the item's current `test_commands`.

### Record A Terminal Failure

```sh
seed verify fail ITEM_ID \
  --owner codex \
  --file src/feature.js \
  --test-cmd "node --test test/feature.test.js" \
  --reason "ITEM_ID fails the declared empty-input behavior"
```

Failure succeeds only when at least one supplied command fails. A failed item is
terminal for the current session, so do not use `fail` as an intermediate
debugging marker. Fix in-scope defects and obtain passing proof before confirming
when the implementation is expected to finish satisfied.

### Exhaust The Queue

Repeat claims and item-specific verification until:

```text
No pending verification items.
```

Do not bulk-confirm items. Shared command output avoids duplicate execution, but
each item still requires relevant files and item-specific evidence. The audit
requires exactly one item-owned producer for each command and product revision,
and rejects missing or multiple producer executions.

### Completion Gate

Run:

```sh
seed verify check
seed verify audit
seed verify report
seed verify status
```

- `check` reruns stored proof commands. Identical command strings are executed
  once and their result is applied to every referencing item.
- `audit` reports incomplete work, failures, expired evidence, missing executable
  proof, and suspicious evidence quality.
- `report` renders status, audit findings, items, files, commands, and evidence.
- `status` emits aggregate machine-readable state and expiry details.

Completion requires:

- Audit reports zero errors.
- `pending`, `claimed`, `failed`, `blocked`, `needs_review`, and `expired` are all
  zero.
- `completed` is `true`.
- `satisfied` is `true`.
- Important user-facing paths have real executable proof.

Then promote the current contract snapshot:

```sh
seed verify sync
```

## Evidence Expiry

Seed stores SHA-256 hashes for evidence files and fingerprints for contract
addresses.

`seed verify status` reports expired evidence when:

- A cited evidence file changed.
- A verified item's Seed address changed.
- An address referenced by a verified item changed.

Expired items return to the pending workflow and require fresh evidence.

For a queue containing only evidence-file expiry, with an unchanged Seed and no
new, active, failed, or blocked items, automation may run:

```sh
seed verify refresh-expired --owner automation --json
```

This strict fast path executes every unique stored proof once and updates all
affected evidence atomically only when every command passes. It refuses semantic
Seed changes and must not replace review of modified contract addresses.

## Working Outside The Project Directory

Place `--repo` before the command:

```sh
seed --repo /path/to/project validate
seed --repo /path/to/project blueprint
seed --repo /path/to/project verify status
```

Seed resolves the contract, genomes, `.seed` state, artifacts, evidence files,
and verification commands relative to that repository.

Do not confuse the global option with `seed genome list --repo`, where `--repo`
filters genome origin.

## Named Seeds

Add `--seed NAME` to any command to select an isolated named Seed. It may appear
after the command, matching normal command options:

```sh
seed init --seed ui
seed validate --seed ui
seed verify start --seed ui
seed list
```

The default remains `seed/seed.yml` with state under `.seed/`. A named Seed such
as `ui` uses `seed/ui/seed.yml` with its snapshots, sessions, and locks under
`.seed/ui/`. Named Seeds do not share verification state with the default or
with one another. `master` is reserved as the name displayed for the default
Seed.

### Cross-Seed References

A named Seed may depend on a compiled address from another Seed without taking
ownership of that Seed's validation or verification work:

```yaml
behavior:
  core-client:
    description: Uses @master:interfaces.http and @master:artifacts.openapi.
    artifacts:
      - master:artifacts.openapi
```

Use `@SEED:ADDRESS` for any compiled address or artifact. Use
`@SEED:genome/GENOME:ADDRESS` when the dependency must also come from a specific
genome, for example `@master:genome/cli-nodejs:constraints.nodejs-cli-runtime`.
The genome-qualified form fails if the address exists but its provenance no
longer matches.

Blueprints include resolved external dependencies with Seed, address, value,
and provenance. `seed verify start` snapshots them, and `seed diff` plus
`seed blueprint diff` report later dependency changes separately. These changes
do not add verification items or expire evidence in the dependent Seed.

## Command Summary

```text
seed [--repo PATH] <command> [options] [--seed NAME]

seed init [--overwrite] [--genome ID] [--genomes ID[,ID...]]
seed install-skill (--codex | --claude)
seed list
seed validate
seed diff [--no-color]

seed genome list [--builtin] [--user] [--repo]
seed genome init NAME [--overwrite]
seed genome validate [--builtin] [--user] [--repo]
seed genome blueprint NAME [blueprint options]

seed blueprint [blueprint options]
seed blueprint diff [--no-color]

seed verify start
seed verify reset
seed verify sync
seed verify pending
seed verify next [--owner OWNER]
seed verify claim ITEM [--owner OWNER]
seed verify confirm ITEM --owner OWNER --file PATH --test-cmd COMMAND
seed verify fail ITEM --owner OWNER --file PATH --test-cmd COMMAND
seed verify check
seed verify refresh-expired --owner OWNER [--json]
seed verify audit
seed verify report
seed verify status
```

Run `seed --help` for the exact current syntax.

## Repository Layout

```text
resources/
├── genomes/              Built-in genome YAML files
└── skills/seed-lang/     Portable Codex and Claude skill bundle
src/
├── cli.js                CLI routing and output
├── genomes.js            Genome loading and composition
├── seed-file.js          Seed initialization and loading
├── validation.js         Structural and reference validation
├── blueprint.js          Constructed contract rendering
├── diff.js               Seed and blueprint diffs
├── verification-store.js Verification sessions and evidence
└── skill-installer.js    Atomic agent-skill installation
test/                     Node test suite
```

## Development

Install dependencies and run the full test suite:

```sh
npm install
npm test
```

Validate every built-in genome:

```sh
node src/cli.js genome validate --builtin
```

Validate the bundled skill with a compatible skill validator, then confirm it is
included in the package:

```sh
npm pack --dry-run --json
```

## Current Boundaries

- Seed does not choose product requirements that are missing from the contract.
- Seed does not replace focused project tests or live acceptance checks.
- Seed does not provide agent persistence, parallel workers, retries, review
  agents, or orchestration.
- Seed records evidence supplied by the implementing process; evidence quality is
  audited but still depends on commands that meaningfully prove each claim.
- `seed verify fail` is terminal for the current session.
- The project is a prototype and its command and contract surfaces may still
  evolve.
