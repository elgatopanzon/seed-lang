# seed-lang
Seed is a contract language for specifying bounded software behavior as the sole authoritative implementation brief.

## Quick usage
- `seed init [--overwrite]`
- `seed install-skill --codex`
- `seed install-skill --claude`
- `seed validate`
- `seed verify start`
- `seed verify next`
- `seed verify confirm <constraint-id> [--evidence TEXT]`
- `seed verify fail <constraint-id> [--reason TEXT]`
- `seed verify refresh-expired --owner OWNER [--json]`
- `seed verify status`

Defaults:
- Seed contract path: `seed/seed.yml`
- CWD: current directory
- Session id: `default`

Validation errors exit nonzero; warnings are shown and do not fail valid contracts.

`install-skill` installs the bundled portable `seed-lang` skill. Codex uses
`${CODEX_HOME:-$HOME/.codex}/skills/seed-lang`; Claude uses
`${CLAUDE_HOME:-$HOME/.claude}/skills/seed-lang`. Exactly one target is required.

`verify refresh-expired` is a strict automation fast path. It accepts only an
expiry-only queue caused by changed evidence files with an unchanged Seed
contract. It runs every unique stored proof command once and atomically refreshes
all affected evidence only when every proof passes.
