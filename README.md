# seed-lang
Seed is a contract language for specifying bounded software behavior as the sole authoritative implementation brief.

## Quick usage
- `seed init [--overwrite]`
- `seed validate`
- `seed verify start`
- `seed verify next`
- `seed verify confirm <constraint-id> [--evidence TEXT]`
- `seed verify fail <constraint-id> [--reason TEXT]`
- `seed verify status`

Defaults:
- Seed contract path: `seed/seed.yml`
- CWD: current directory
- Session id: `default`

Validation errors exit nonzero; warnings are shown and do not fail valid contracts.
