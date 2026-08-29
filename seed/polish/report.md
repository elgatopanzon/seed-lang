# Polish Review

## Executive assessment

The accepted implementation satisfies the master product boundary, but its
verification repairs accumulated too much authority in one module and left an
obsolete Seed-side producer path behind. The highest-value polish is therefore
architectural containment: one evidence producer, one reference classifier,
real executable-boundary CLI proof, and one declared home for Seed-owned support.

The polish Seed preserves every master genome, existing address, behavior,
interface, state meaning, error semantic, compatibility statement, trust
boundary, and distribution promise. `requirements` remains empty. It adds four
internal-quality constraints and four focused verifications, and narrows the
description of the existing `seed-evidence-scripts` artifact to its intended
ownership. No product feature or stronger external guarantee is introduced.

## Findings encoded in polish Seed

1. **P0: Shared evidence production needs a focused production boundary.**
   `src/verification-store.js` is about 2,200 lines and owns filesystem paths,
   locks, atomic JSON persistence, revision hashing, command execution, reuse,
   diagnostics, claims, reconciliation, audit, reports, refresh, and sync.
   Its `productRevision`, `runTestCommands`, result-hash helpers, fan-out logic,
   and cache-integrity checks form a coherent evidence-producing subsystem, but
   they are interleaved with ledger orchestration. The same concentration is
   mirrored by the roughly 1,800-line `test/verification-store.test.js`.
   Commits `ff923d7`, `f7c6d72`, `f149213`, `acf077c`, and `1c6b195` repeatedly
   repaired ownership, failure retention, retry, revision consistency, and
   legacy-record rejection in that surface. The desired boundary is encoded by
   `@constraints.evidence-producer-ownership` and proven by
   `@verifications.evidence-producer-architecture`. The recommendation is a
   focused production component and focused native tests, while preserving the
   accepted session lock, atomic ledger, result schema, retry behavior, and CLI.

2. **P1: Reference syntax has competing parsers.** `src/validation.js`,
   `src/genomes.js`, and `src/blueprint.js` each define a local-reference regular
   expression and recursive scanner, while `src/external-references.js` defines
   the cross-Seed and genome-qualified scanner. Their treatment of the colon
   following a local-looking token already differs. Validation, blueprint
   closure, genome selector closure, and dependency resolution therefore have
   separate authorities for one accepted syntax. This invites drift when a
   reference form changes. `@constraints.reference-classification-authority`
   and `@verifications.reference-classification-consistency` require one
   classifier with consumer-specific diagnostics and closure retained.

3. **P1: Most CLI integration claims bypass the executable boundary.**
   `test/cli.test.js` calls exported `run()` through a console/stdout/chdir
   monkeypatch helper roughly 178 times, while its real child-process coverage
   is principally the large piped-output case. `test/verification-store.test.js`
   adds child-process coverage for concurrent confirmation, and
   `seed/scripts/verify-readme.js` performs broader disposable CLI smoke work,
   but neither gives the native CLI suite a clear process-level contract for
   argument parsing, exit status, stream separation, environment, and failed
   confirmation diagnostics. `@constraints.executable-cli-test-boundary` and
   `@verifications.executable-cli-boundary` establish that distinction without
   discarding fast handler-level unit tests.

4. **P2: Seed-owned executable support has an unowned second path.** The master
   declares `seed/scripts` as `@seed-evidence-scripts`, yet
   `seed/evidence/verify-distillation.js` sits outside that artifact. It still
   exposes `producerDefinitions`, `executeProducer`, and a `producer` operation
   for commands already owned by the native suite and production verification
   ledger. No command in the accepted `.seed/sessions/default.json` uses that
   producer operation. The earlier confirmation-aware cache was deleted in
   `f7c6d72`, but its dispatcher remains a plausible route back to competing
   producer ownership. `@artifacts.seed-evidence-scripts`,
   `@constraints.seed-support-ownership`, and
   `@verifications.seed-support-hygiene` require all retained Seed support to be
   declared, single-purpose, read-only or disposable, and free of a parallel
   cache or native-test registry.

## Run-history lessons

Final verification required nine review rounds. The first ledger executed the
same expensive commands repeatedly. The first repair then layered session reuse
over a confirmation-aware `/tmp` cache, leaving two writers. The next repair
lost failed confirmation diagnostics. The following repair persisted failures
as reusable results, poisoning retries after an external prerequisite changed.
Later rounds found legacy repeated records without revision, producer, reuse,
or result-hash metadata, and audit initially treated that condition as warnings.

The preventable cause was not a missing individual assertion. Ownership was
split between a Seed-side harness and the session store, while producer rules
were added incrementally inside an already broad module. The successful repair
converged on session locking, content-derived revision identity, complete
attempt retention, passing-only reuse, re-execution of failures, atomic writes,
and audit rejection of invalid repeated groups. The polish addresses preserve
those accepted semantics and make their ownership visible enough that future
changes can be tested in isolation. Provider and sandbox interruptions were
transient host conditions and create no Seed requirement.

## Repository hygiene

The deterministic hygiene scan inventoried all 103 reachable commits and found
no critical or high secret finding. Its first pass failed while decoding the
tracked PNG as UTF-8; the successful pass capped inspected blob content at
100,000 bytes and therefore reported the large banner and committed verification
ledger rather than scanning those blobs as text. Optional secret scanners were
not installed. The numerous medium commit-email findings repeat public author
metadata previously accepted for this public repository; package-lock address
matches and private-word/URL readiness matches are detector noise or describe
the intentional private npm-package flag. No raw values are reproduced here.

`README.md`, `LICENSE`, `package.json`, and the lockfile accurately describe a
public MIT repository whose `0.0.0` npm package remains private and unpublished.
No workstation path, local username, LAN hostname, or private dependency is
embedded in the tracked production source. Tests already live under `test/`,
use Node's native test framework, and clean disposable repositories. The
specific support ownership gap under `seed/evidence` is encoded; broad test
helper consolidation is not, because the small fixture variants remain local
to coherent domains.

The tracked `.seed` ledger is generated and large, but it is an intentional
verification-state artifact in the accepted workflow and is reproducibly
managed through Seed commands. Ignoring or deleting it would change that
workflow. `assets/seed-banner.png` is intentionally presentation-only and is
already excluded from this review by `seed/distillation-exclusions.md`.

## Deferred or rejected suggestions

- CI, `SECURITY.md`, contributor process, additional publication documentation,
  npm release, package renaming, support promises, and a Node engines floor are
  new project or distribution decisions. They are not encoded.
- Stronger symlink-sensitive evidence containment, a transaction spanning every
  snapshot/session file, additional crash recovery, different cache freshness,
  telemetry, and broader portability would harden observable security,
  reliability, or compatibility semantics. They require an explicit product
  Seed change.
- Visual layout, ANSI policy, table geometry, pager choreography, screenshots,
  and the banner remain exclusively deferred to the future UI Seed.
- Removing committed `.seed` state or the banner, rewriting history for already
  accepted public author metadata, adding a different license, or treating
  scanner false positives as defects would contradict accepted repository
  intent.
- A general rewrite of `src/cli.js` or `src/verification-store.js`, wholesale
  test-helper abstraction, framework replacement, and style-only cleanup lack a
  narrower evidence-backed benefit. The polish Seed constrains only the concrete
  duplicated authorities and proof boundaries above.
