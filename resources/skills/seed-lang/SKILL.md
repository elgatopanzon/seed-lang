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
3. Add `--seed NAME` to select `seed/NAME/seed.yml` and its isolated `.seed/NAME` state; omit it for `seed/seed.yml` and `.seed/`.
4. If the selected Seed file exists, default to Seed Driven Development.
5. Run `seed validate` and stop on structural errors.
6. Read `seed blueprint`, including `Global Policies` and applicable artifacts.
7. Use `seed blueprint diff --no-color` for the complete constructed contract
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

1. Treat `requirements` as a temporary planning inbox. Convert every entry into
   the appropriate contract sections, verifications, and artifacts, then remove
   it. Do not begin implementation while any entry remains.
2. Inspect available presets with `seed genome list`, use `seed genome search`
   for targeted discovery, and inspect candidates with
   `seed genome blueprint NAME`.
3. Record observable requirements in the appropriate addressable sections.
4. Preserve stable IDs when meaning is unchanged.
5. Put genuine implementation choices in `freedom`; do not use freedom to hide
   missing product decisions or external contracts.
6. Add explicit artifacts for schemas, fixtures, samples, golden files,
   protocols, APIs, formats, and other implementation-critical material.
7. Add item-specific verifications with concrete methods and evidence.
8. Run `seed validate` and inspect the complete blueprint.
9. Apply [Seed Readiness Check](references/seed-readiness.md) until the result is
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

Named Seeds can reference another Seed's compiled addresses with
`@SEED:ADDRESS`. Use `@SEED:genome/GENOME:ADDRESS` to additionally require that
the address came from a specific genome. External references are dependencies,
not verification ownership: inspect them in blueprints and diffs, but do not
claim or verify the source Seed's items from the dependent Seed.

Valid sections:

- `metadata`: project name, summary, and optional non-empty string-list tags.
- `genomes`: reusable Seed fragments composed before local values.
- `requirements`: temporary raw planning TODOs; must be empty before implementation.
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

Find relevant definitions with `seed genome search QUERY`. Search matches IDs,
metadata names and descriptions, tags, and direct authored address names. Add
`--full-text` only when values inside direct authored addresses should also be
searched. Results identify origins, tags, match types, and matching addresses.

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
