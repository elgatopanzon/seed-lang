---
name: seed-lang
description: Plan, author, inspect, update, implement, and verify software from Seed contracts. Use for seed/seed.yml, Seed genomes and blueprints, Seed Driven Development, implementation from a Seed brief, incremental contract changes, verification evidence, expired evidence, readiness checks, and Seed CLI commands.
---

# Seed Lang

Seed is a contract format for bounded software implementation. Treat
`seed/seed.yml` as the authoritative product brief. Treat implementation details
as freedom only where the Seed leaves them unconstrained.

## Required References

- For implementation or code changes, read [Standalone SDD](references/sdd.md)
  completely before editing.
- For planning or materially changing a Seed, read
  [Seed Readiness Check](references/seed-readiness.md) before declaring it ready.
- For exact CLI syntax and command semantics, read
  [Seed Commands](references/commands.md).

## First Steps

1. Confirm `seed` is available on `PATH`.
2. Work from the project root or put `--repo PATH` immediately after `seed`.
3. If `seed/seed.yml` exists, default to Seed Driven Development.
4. Run `seed validate` and stop on structural errors.
5. Read `seed blueprint`, including `Global Policies` and applicable artifacts.
6. Use `seed blueprint diff --no-color` for the complete constructed contract
   change. Use `seed diff --no-color` for lower-level compiled YAML diagnostics.

## Seed Driven Development

The direct portable SDD loop is:

1. Change the Seed contract first when desired behavior changes.
2. Validate and inspect the fully constructed blueprint diff.
3. Implement the smallest coherent contract change.
4. Prove each verification item with focused executable evidence.
5. Run the global evidence checks and require a satisfied status.
6. Sync the verified Seed snapshot.

This workflow does not require an orchestrator, runner, reviewer, task graph, or
vendor-specific agent feature. Follow [Standalone SDD](references/sdd.md) for the
complete implementation and completion procedure.

## Seed Authoring

When creating or updating a Seed:

1. Inspect available presets with `seed genome list` and targeted
   `seed genome blueprint NAME` commands.
2. Record observable requirements in the appropriate addressable sections.
3. Preserve stable IDs when meaning is unchanged.
4. Put genuine implementation choices in `freedom`; do not use freedom to hide
   missing product decisions or external contracts.
5. Add explicit artifacts for schemas, fixtures, samples, golden files,
   protocols, APIs, formats, and other implementation-critical material.
6. Add item-specific verifications with concrete methods and evidence.
7. Run `seed validate` and inspect the complete blueprint.
8. Apply [Seed Readiness Check](references/seed-readiness.md) until the result is
   **Implementation-ready**.

### External Contract Artifacts

Research authoritative external APIs, protocols, standards, services, schemas,
and formats before writing dependent requirements. Preserve the required subset
in a repository-local artifact with its source URL, version or revision, and
access date. Declare the artifact and attach its ID to every dependent Seed item.
Do not rely only on a mutable website or invent missing contract details.

## Seed Structure

Seed files are YAML. Addressable sections accept tree objects or lists with IDs.
Tree keys form addresses:

```yaml
constraints:
  no-network:
    description: Must not make outbound network calls.
    policy: global
```

The address is `constraints.no-network`; reference it as
`@constraints.no-network`. Artifact IDs may be referenced as `@sample-input` or
`@artifacts.sample-input`. Any item mentioning an artifact must also list that
artifact ID in its `artifacts:` field.

Valid sections:

- `metadata`: project name and summary.
- `genomes`: reusable Seed fragments composed before local values.
- `scope`: included and excluded boundaries.
- `artifacts`: local relative files or HTTP(S) resources.
- `interfaces`: CLI, API, UI, files, automation, and integrations.
- `behavior`: functional and output behavior.
- `errors`: failure conditions and remediation.
- `state`: persistence, consistency, retention, and migration semantics.
- `security`: trust, authorization, secrets, and access boundaries.
- `environment`: runtime, platform, dependency, and deployment assumptions.
- `observability`: diagnostics, logs, health, metrics, and audit behavior.
- `compatibility`: stability and migration promises.
- `constraints`: binding implementation or non-functional requirements.
- `freedom`: explicit implementation choices left open.
- `verifications`: acceptance methods and required evidence.

Use `policy: global` for requirements active during every implementation and
verification item. Security items default to global. Ordinary items default to
local policy.

## Genomes

Genome precedence, lowest to highest:

1. Built-ins shipped with Seed.
2. User genomes under `~/.seed/genomes/`.
3. Repository genomes under `seed/genomes/`.
4. Local `seed/seed.yml` values.

Genome entries support composition, complete transitive exclusion, section or
address selection, and comma-separated include/exclude filters:

```yaml
genomes:
  - cli-nodejs
  - !cli-single-command
  - cli-nodejs[constraints]
  - starter-local-safe[!*no-network*]
  - monorepo-api-web[interfaces,!*http*]
```

A standalone `!genome-id` removes that genome everywhere in the composed graph.
Bracket entries beginning with `!` remove matching addresses after composition.
Unmatched genome exclusions and unknown genomes fail validation.

## Fail Loud

- Stop on invalid Seed structure or missing authoritative artifacts.
- Surface conflicts between the Seed and implementation.
- Do not confirm unexecuted or generic evidence.
- Do not silently fall back when required behavior cannot be implemented.
- Do not claim completion while verification remains pending, expired, failed,
  blocked, incomplete, or unsatisfied.
