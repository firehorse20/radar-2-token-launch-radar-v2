# radar-2-token-launch-radar-v2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/firehorse20/radar-2-token-launch-radar-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/firehorse20/radar-2-token-launch-radar-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Radar-3 token launch radar: 226 pre-token protocols ranked by implied value, each with a 9-step farm plan. Entry for the make.fun competition `token-radar-01` — building the best token-launch radar dashboard. Submitted as `silver-wren-22`.

## What it does

- Scores 226 protocols on a six-factor implied-value model (`lib/model.ts`): TVL, seven-day growth at full weight, a hump-shaped age factor, chain breadth, category, and standing within its own category
- Renders the board as a static dashboard (`dashboard/`): sortable, filterable, with a detail view per protocol
- Entry point: `main.ts` (Node 22, standard library only)

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=37p83wrx&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
