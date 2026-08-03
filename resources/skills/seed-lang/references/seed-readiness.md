# Seed Readiness Check

Use this check after authoring or modifying a Seed and before implementation.
It is a manual review procedure, not a `seed` CLI command.

1. Run `seed validate`, then read the complete `seed blueprint`, including
   genomes and global policies.
2. For every in-scope interface, behavior, state, error, security,
   compatibility, and verification item, decide whether implementation needs a
   concrete artifact. Check data schemas, external contracts, user-visible
   formats, examples, fixtures, golden files, migrations, configuration,
   integrations, trust boundaries, deployment, and reproducible failures.
3. Confirm each required artifact is declared, exists at its repository-relative
   path, contains enough detail, and is attached to every dependent Seed item.
   A remote URL alone is insufficient for an implementation-critical external
   contract.
4. Reverse-check terms such as schema, payload, field, database, table, event,
   protocol, API, endpoint, integration, format, migration, configuration, and
   version. Identify a linked artifact or a specific blocker for each material
   match.
5. Report **Implementation-ready** only when validation passes, artifacts are
   sufficient and traceable, external and data contracts are specified, and no
   requirement forces implementation to invent a product fact.

If not ready, report missing or weak artifacts, affected addresses, why each is
needed, and the next research or authoring action. Research authoritative
sources, create concise local contract artifacts with source URL, version or
revision, and access date, attach them to dependent items, then repeat validation
and readiness review.

Do not hide missing product facts in implementation freedom. Use freedom only
for choices that do not alter observable behavior, data meaning, compatibility,
security, or verification.
