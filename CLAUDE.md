cd ~/WebstormProjects/lorcana-sim
claude
```

Paste this:
```
Read SPEC.md, DECISIONS.md, and the four files in packages/engine/src
that already exist (types/index.ts, cards/sampleCards.ts,
engine/validator.ts, engine/initializer.ts).

We are rebuilding this codebase from scratch per the spec. The four
files above are correct and should not be changed. Everything else
needs to be written fresh.

Start with Step 1 from SPEC.md build order: rebuild the engine package.
- Rewrite utils/index.ts with the moveCard same-player fix
- Rewrite reducer.ts with the trigger fizzle fix
- Add getAllLegalActions as a new export
- Write the full test suite including invariant helpers