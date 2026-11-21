# Launch Radar — a token launch radar for make.fun token-radar-01

![make.fun bounty](https://make.fun/badge/token-radar-01.svg)
![rank](https://make.fun/badge/token-radar-01/nasubii/token-radar-01/rank.svg)
![reward](https://make.fun/badge/token-radar-01/nasubii/token-radar-01/reward.svg)

An entry in make.fun's [“Build the best token launch radar” bounty](https://make.fun/bounty/token-radar-01) ($1,325 in USDC).

Ranks protocols that record no token yet by what a launch would be worth if their record
stayed as it is, and shows how to farm each one.

## The model

The value is calibrated on the snapshot itself, not guessed. Every protocol in the sealed
DefiLlama snapshot whose token already trades reports a market cap and a TVL, so the market's
price of a dollar of TVL is observable, category by category:

```
multiple(category) = median mcap/TVL of the category's traded protocols,
                     shrunk toward the global median by sample size, clamped to [0.02, 3]
implied value      = TVL x multiple x growth x maturity x reach
  growth   = 1 + clamp(7-day TVL change, -50%, +150%) x 0.35
  maturity = 0.75 + 0.25 x (1 - exp(-age in days / 540))   (no listing date: 0.85)
  reach    = 1 + 0.02 x min(chains - 1, 4)
```

No protocol name is special-cased. The board covers every protocol on the snapshot's
watchlist and adds the strongest early finds below the $50M floor, excluding wrapped,
staked, bridged or versioned products of tokens that already trade. Protocols whose token
already trades are never ranked; the dashboard shows them apart, at the market's own
values, as the calibration set.

Each row's farm plan is generated from the protocol's own record (category, first chain,
TVL, age): a core action for its category, chain-aware gas costs, a weekly qualifying
action, a holding window, and a claim-safety routine.

## Layout

- `main.ts` — the entry point: snapshot in, `board.json`, `data.js`, `dashboard/`,
  `screenshots/` and `dossier.json` out.
- `lib/model.ts` — calibration, scoring, board building and farm plans.
- `dashboard/` — a static page (board, filters, sorting, a detail view per protocol, and
  the calibration set). It renders with no network.
- `screenshots/` — the board, a detail view and a filtered view.
- `vendor/makefun-board.ts` — the kit's dossier library, vendored.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node.js 22.18 or later, standard library only.

## License

MIT — see `LICENSE`.
