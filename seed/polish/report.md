# Polish Review

## Executive assessment

The polish Seed is restricted to improving the accuracy and wording of the
as-built contract. It does not add behavior, architecture, security guarantees,
evidence systems, implementation constraints, verification obligations, or
genomes that the current product does not already satisfy.

The master Seed accurately captures the implemented Seed language and CLI. No
eligible product-neutral contract expansion was found. The polish Seed therefore
preserves every master address, genome, verification method, and evidence
requirement unchanged.

## Wording corrections retained

The repository is public under MIT, while `package.json` marks the npm package
private against registry publication. The master Seed repeatedly describes the
whole project, source, package, or contract distribution as private. The polish
Seed corrects only that factual distinction:

- The source repository and contract distribution are public under MIT.
- Version `0.0.0` remains an unpublished npm prototype.
- Local installation and package dry-run behavior remain supported.
- npm registry publication remains outside the active product surface.

These corrections do not change implementation or acceptance behavior.

## Suggestions reviewed but not encoded

The review identified possible improvements involving multi-file verification
transactions, filesystem-link evidence containment, a shared evidence producer,
and reorganization of Seed support scripts. None describe current as-built
behavior. Encoding them would invent product guarantees and implementation work,
so they are deliberately absent from `seed/polish/seed.yml`.

Such changes require a separate explicit Seed-first product decision. They must
not enter a distilled or polished Seed merely because a reviewer considers them
desirable.

## Distillation boundary

Future distillation polish may correct omissions or inaccurate wording only when
repository code, tests, documentation, artifacts, and history already establish
the behavior. Potential improvements, defects, aspirational genomes, and stronger
quality policies belong in a review report or later user-authorized Seed change,
not in the replacement Seed.

Visual UI remains deferred to `seed/distillation-exclusions.md` and is unchanged.
