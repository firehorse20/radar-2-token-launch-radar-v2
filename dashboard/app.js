// Token Radar dashboard (radar-3). Reads window.RADAR — the dataset main.ts
// writes beside dashboard/ — and renders the ranked board, its filters, a
// per-protocol detail view and the live-token set. No network: every byte
// shown is already in data.js. Every protocol has its own URL:
// #/protocol/<slug>. Filters live in #/?q=&category=&chain=&tvl=.
//
// The file is organised by job, top to bottom: formatters, the model mirror
// (the same function lib/model.ts scores with, so the page can recompute a
// row and check the number board.json carries), the farm-plan tables, the
// DOM helper, hash routing, filtering and sorting, then one renderer per
// surface — header, lede, controls, board table, live table, model panel,
// detail dialog — and the boot code that wires them together.
(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // 0. Boot guard and shared state.
  // -------------------------------------------------------------------------
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = {
    q: '',
    category: 'all',
    chain: 'all',
    tvl: 0,
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null,
  };

  // -------------------------------------------------------------------------
  // 1. Formatters: money, growth, age.
  // -------------------------------------------------------------------------
  var usd = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // -------------------------------------------------------------------------
  // 2. The model, mirrored: TVL x 0.25, growth at full weight, a hump-shaped
  //    maturity, chain breadth, a category table and standing within the
  //    category — exactly as lib/model.ts scores it. Keep this table in step
  //    with CATEGORY_MULT there: a row the page recomputes differently from
  //    board.json reads as stale data. Standing is recomputed here from the
  //    board's own rows, the same set lib/model.ts scores.
  // -------------------------------------------------------------------------
  var CAT = {
    Dexs: 1.08,
    Lending: 1.08,
    CDP: 1.08,
    Yield: 1.06,
    Derivatives: 1.05,
    'Risk Curators': 1.05,
    'Onchain Capital Allocator': 1.05,
    'Yield Aggregator': 1.04,
    'Basis Trading': 1.04,
    'Leveraged Farming': 1.04,
    'Liquidity Manager': 1.05,
    Farm: 1.04,
    RWA: 1.02,
    'Liquid Staking': 0.92,
    'Staking Pool': 0.92,
    Restaking: 0.92,
    Bridge: 0.9,
    'Canonical Bridge': 0.9,
    'Liquid Restaking': 0.92,
    'Restaked BTC': 0.92,
  };

  function catMult(cat) {
    if (cat === null || cat === undefined) return 0.97;
    return CAT[cat] === undefined ? 1 : CAT[cat];
  }

  function chainMult(chains) {
    var n = chains ? chains.length : 0;
    return 1 + 0.025 * Math.min(Math.max(n - 1, 0), 8);
  }

  function growthMultOf(row, model) {
    var growth = Math.min(
      model.growth_cap,
      Math.max(
        model.growth_floor,
        row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d,
      ),
    );
    return 1 + (growth / 100) * model.growth_weight;
  }

  function maturityMultOf(row, model) {
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var days = Math.min(Math.max(age, 0), model.maturity_days);
    if (days <= model.maturity_peak_days) {
      return (
        model.maturity_floor +
        (days / model.maturity_peak_days) * (model.maturity_peak - model.maturity_floor)
      );
    }
    return (
      model.maturity_peak -
      ((days - model.maturity_peak_days) / (model.maturity_days - model.maturity_peak_days)) *
        (model.maturity_peak - model.maturity_late)
    );
  }

  // Standing: each row's TVL rank within its own category, over the board's
  // own rows — the same set lib/model.ts scores. Computed once, at boot.
  var STANDING = (function () {
    var byCat = {};
    var model = DATA.model;
    DATA.rows.forEach(function (r) {
      if (r.category === null || r.category === undefined) return;
      (byCat[r.category] = byCat[r.category] || []).push(r);
    });
    var map = {};
    Object.keys(byCat).forEach(function (c) {
      var list = byCat[c].slice().sort(function (a, b) {
        return b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
      });
      list.forEach(function (r, i) {
        map[r.slug] = model.standing_floor + model.standing_range * (1 - i / list.length);
      });
    });
    return map;
  })();

  function standingMultOf(row) {
    if (row.category === null || row.category === undefined) return 1;
    return STANDING[row.slug] === undefined ? 1 : STANDING[row.slug];
  }

  function impliedOf(row, model) {
    return Math.max(
      1,
      Math.round(
        row.tvl_usd *
          model.base_multiple *
          growthMultOf(row, model) *
          maturityMultOf(row, model) *
          chainMult(row.chains) *
          catMult(row.category) *
          standingMultOf(row),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // 3. Farm plans: the same derivation main.ts writes to board.json.
  //    Category, chains, TVL and age decide the action, the weekly action,
  //    the monitor and the exit, the capital, the hold and every cost and
  //    time. No name is special-cased, and no step assumes the protocol runs
  //    a points program: where a step touches points or a claim, it says to
  //    check whether one exists and to use only the link the protocol itself
  //    publishes. Nine steps per protocol.
  // -------------------------------------------------------------------------
  function chainOf(p) {
    return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
  }

  var COSMOS_CHAINS = {
    'Cosmos Hub': 1,
    Osmosis: 1,
    Injective: 1,
    Sei: 1,
    Celestia: 1,
    Neutron: 1,
    dYdX: 1,
    Kava: 1,
  };

  function chainFamily(chain) {
    if (chain === 'Solana') return 'Solana';
    if (chain === 'Bitcoin') return 'Bitcoin';
    if (COSMOS_CHAINS[chain]) return 'Cosmos';
    return 'EVM';
  }

  function walletFor(family, chain) {
    if (family === 'Solana') {
      return 'Open a fresh Solana wallet that holds only the funds you plan to farm, and keep its seed phrase offline.';
    }
    if (family === 'Bitcoin') {
      return 'Open a fresh Bitcoin wallet that holds only the funds you plan to farm, and keep its seed phrase offline.';
    }
    if (family === 'Cosmos') {
      return (
        'Open a fresh Cosmos wallet that supports ' +
        chain +
        ' and holds only the funds you plan to farm, and keep its seed phrase offline.'
      );
    }
    return (
      'Open a fresh EVM wallet that supports ' +
      chain +
      ' and holds only the funds you plan to farm, and keep its seed phrase offline.'
    );
  }

  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }

  function gasFor(family, capital) {
    if (family === 'Solana') return 1;
    if (family === 'Bitcoin') return 5;
    return capital >= 150 ? 8 : 4;
  }

  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function holdReason(age) {
    if (age === null || age === undefined) return 'so the activity is counted in more than one snapshot';
    if (age < 180) return 'so a young protocol sees a full qualifying window';
    if (age < 365) return 'so the activity spans more than one snapshot';
    return 'so the activity is counted in more than one snapshot';
  }

  // A category test from words: true when the category names any of them.
  function has() {
    var words = arguments;
    return function (c) {
      for (var i = 0; i < words.length; i++) if (c.indexOf(words[i]) >= 0) return true;
      return false;
    };
  }

  // A category test for one exact name.
  function is(word) {
    return function (c) {
      return c === word;
    };
  }

  // First rule whose test matches the category, or null: every farm table
  // below is tried in order and the first match wins.
  function firstMatching(rules, category) {
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].test(category)) return rules[i];
    }
    return null;
  }

  // The main action, as a table: the first category test that matches wins.
  var MAIN_ACTIONS = [
    {
      test: has('lend', 'cdp', 'collateral'),
      build: function (p, capital, chain) {
        return 'Supply $' + capital + ' of USDC to ' + p.name + ' on ' + chain + ' and keep the position open.';
      },
    },
    {
      test: has('dex', 'yield', 'leveraged farm'),
      build: function (p, capital, chain) {
        return (
          'Provide $' +
          capital +
          ' of liquidity to ' +
          p.name +
          "'s main pool on " +
          chain +
          ' and keep the position open.'
        );
      },
    },
    {
      test: has('bridge'),
      build: function (p, capital, chain) {
        return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + p.name + ' and use the bridged funds in its app.';
      },
    },
    {
      test: has('staking', 'restak'),
      build: function (p, capital) {
        return "Stake $" + capital + " of the chain's staking asset through " + p.name + ' and keep the receipt.';
      },
    },
    {
      test: has('interest rate'),
      build: function (p, capital, chain) {
        return (
          'Deposit $' + capital + ' of USDC into ' + p.name + "'s fixed-rate market on " + chain + ' and hold it to maturity.'
        );
      },
    },
    {
      test: has('perpetual', 'derivative'),
      build: function (p, capital) {
        return 'Deposit $' + capital + ' of USDC as margin on ' + p.name + ' and open one small hedge.';
      },
    },
    {
      test: has('prediction'),
      build: function (p, capital) {
        return 'Fund $' + capital + ' and place one market position on ' + p.name + '.';
      },
    },
    {
      test: has('curator', 'allocator'),
      build: function (p, capital, chain) {
        return 'Deposit $' + capital + ' into a ' + p.name + ' vault on ' + chain + ' and keep the shares.';
      },
    },
    {
      test: has('stable'),
      build: function (p, capital, chain) {
        return 'Mint or deposit $' + capital + ' of the stable asset through ' + p.name + ' on ' + chain + '.';
      },
    },
    {
      test: has('rwa'),
      build: function (p, capital, chain) {
        return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
      },
    },
    {
      test: has('insurance'),
      build: function (p, capital, chain) {
        return 'Buy $' + capital + ' of cover from ' + p.name + ' on ' + chain + ' and keep the policy.';
      },
    },
    {
      test: has('payment'),
      build: function (p, capital, chain) {
        return 'Route $' + capital + ' of payments through ' + p.name + ' on ' + chain + ' and keep the channel funded.';
      },
    },
    {
      test: is('chain'),
      build: function (p, capital, chain) {
        return 'Delegate $' + capital + ' to a validator of ' + p.name + ' on ' + chain + ' and keep the delegation.';
      },
    },
    {
      test: has('btc'),
      build: function (p, capital, chain) {
        return 'Wrap $' + capital + ' of BTC through ' + p.name + ' on ' + chain + ' and use the wrapped asset in its app.';
      },
    },
    {
      test: has('index'),
      build: function (p, capital, chain) {
        return 'Buy $' + capital + ' of the ' + p.name + ' index on ' + chain + ' and hold the index token.';
      },
    },
    {
      test: has('governance'),
      build: function (p, capital, chain) {
        return 'Lock $' + capital + ' of the governance asset in ' + p.name + ' on ' + chain + ' and vote once.';
      },
    },
    {
      test: has('card'),
      build: function (p, capital, chain) {
        return 'Load $' + capital + ' onto the ' + p.name + ' card from ' + chain + ' and make one purchase.';
      },
    },
    {
      test: has('cedefi'),
      build: function (p, capital, chain) {
        return (
          'Deposit $' + capital + ' of USDC into ' + p.name + "'s managed account on " + chain + ' and keep the position open.'
        );
      },
    },
  ];

  function actionFor(p, capital, chain) {
    var rule = firstMatching(MAIN_ACTIONS, (p.category || '').toLowerCase());
    if (rule) return rule.build(p, capital, chain);
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
  }

  function secondActionFor(p, half) {
    if (p.chains && p.chains.length >= 2) {
      return (
        'Repeat the main position on ' + p.chains[1] + ' with $' + half + ' so the farm is counted on two chains, not one.'
      );
    }
    return (
      'Top up the main position with another $' + half + ' a week later so the farm shows repeat activity, not one deposit.'
    );
  }

  // The weekly qualifying action, as a table: the first match wins.
  var WEEKLY_ACTIONS = [
    {
      test: has('lend', 'cdp'),
      build: function () {
        return 'Borrow $20 against the deposit and repay it the same week, so the position shows both sides.';
      },
    },
    {
      test: has('dex'),
      build: function () {
        return "Swap $20 through the protocol's own pool and add $10 of liquidity if the pool allows it.";
      },
    },
    {
      test: has('interest rate'),
      build: function () {
        return 'Roll $20 of the fixed-rate position into a fresh term.';
      },
    },
    {
      test: has('perpetual', 'derivative'),
      build: function () {
        return 'Close the hedge and open a fresh small one, keeping the margin in place.';
      },
    },
    {
      test: has('bridge'),
      build: function () {
        return 'Bridge $20 to a second chain the protocol supports and use it in its app.';
      },
    },
    {
      test: has('staking', 'restak'),
      build: function () {
        return 'Restake the rewards the position earned and keep the receipt token.';
      },
    },
    {
      test: has('prediction'),
      build: function () {
        return 'Place one small market position and settle it before the week ends.';
      },
    },
    {
      test: has('yield', 'curator', 'allocator'),
      build: function () {
        return 'Harvest the yield the vault earned and redeposit it into the same vault.';
      },
    },
    {
      test: has('stable'),
      build: function () {
        return 'Move $20 of the stable asset in and out of the protocol so the position shows weekly use.';
      },
    },
    {
      test: has('rwa'),
      build: function () {
        return 'Check the yield the protocol paid this week and reinvest $20 of it.';
      },
    },
    {
      test: has('insurance'),
      build: function () {
        return 'Review the cover the protocol holds for your position and renew any part that lapsed.';
      },
    },
    {
      test: has('payment'),
      build: function () {
        return 'Send one $20 payment through the protocol and confirm it settles.';
      },
    },
    {
      test: is('chain'),
      build: function () {
        return 'Vote once on a governance proposal or re-delegate $20.';
      },
    },
    {
      test: has('btc'),
      build: function () {
        return "Move $20 of the wrapped asset through the protocol's app and back.";
      },
    },
    {
      test: has('index'),
      build: function () {
        return 'Rebalance $20 into the index.';
      },
    },
    {
      test: has('governance'),
      build: function () {
        return 'Vote once on a protocol proposal.';
      },
    },
    {
      test: has('card'),
      build: function () {
        return 'Make one $20 purchase with the card.';
      },
    },
    {
      test: has('cedefi'),
      build: function () {
        return 'Check the managed position the protocol reports and add $20.';
      },
    },
  ];

  function weeklyFor(p) {
    var rule = firstMatching(WEEKLY_ACTIONS, (p.category || '').toLowerCase());
    if (rule) return rule.build();
    return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
  }

  // What to watch each week, by category — plus the points caveat: a points
  // program is checked only where the protocol publishes one.
  var MONITOR_ACTIONS = [
    {
      test: has('lend', 'cdp', 'collateral'),
      build: function (p) {
        return (
          'Check the borrow rate and the health factor of your ' +
          p.name +
          ' position once a week; top it up before it nears liquidation.'
        );
      },
    },
    {
      test: has('dex'),
      build: function (p) {
        return (
          "Check the pool's price range and the fees your " +
          p.name +
          ' position earned once a week; rebalance if it drifts out of range.'
        );
      },
    },
    {
      test: has('interest rate'),
      build: function (p) {
        return 'Check the fixed rate ' + p.name + ' pays and the term left once a week.';
      },
    },
    {
      test: has('perpetual', 'derivative'),
      build: function (p) {
        return (
          'Check the funding rate and your margin on ' +
          p.name +
          ' once a week; add margin before a funding spike liquidates the hedge.'
        );
      },
    },
    {
      test: has('bridge'),
      build: function (p) {
        return (
          'Check ' +
          p.name +
          "'s supported routes and finality once a week; a route that stalls is a reason to wait, not to retry blindly."
        );
      },
    },
    {
      test: has('staking', 'restak'),
      build: function (p) {
        return (
          'Check the staking APR and the validator ' +
          p.name +
          ' uses once a week; a validator that misses blocks is a reason to switch.'
        );
      },
    },
    {
      test: has('prediction'),
      build: function (p) {
        return 'Check whether your ' + p.name + ' market resolved once a week and settle it before the week ends.';
      },
    },
    {
      test: has('yield', 'curator', 'allocator'),
      build: function (p) {
        return (
          'Check the vault APY and strategy ' + p.name + ' reports once a week; a strategy change is a reason to re-read the plan.'
        );
      },
    },
    {
      test: has('stable'),
      build: function (p) {
        return "Check the stable asset's peg on " + p.name + ' once a week; a depeg is a reason to exit, not to add.';
      },
    },
    {
      test: has('rwa'),
      build: function (p) {
        return (
          'Check the backing and redemption terms ' +
          p.name +
          ' publishes once a week; a redemption pause is a reason to wait.'
        );
      },
    },
    {
      test: has('insurance'),
      build: function (p) {
        return 'Check the cover ' + p.name + ' holds and its expiry once a week; renew before it lapses.';
      },
    },
    {
      test: has('payment'),
      build: function (p) {
        return 'Check that your ' + p.name + ' channel stays funded once a week; top it up before it runs dry.';
      },
    },
    {
      test: is('chain'),
      build: function (p) {
        return (
          'Check ' + p.name + "'s validator set and governance votes once a week; a missed vote is a missed signal."
        );
      },
    },
    {
      test: has('btc'),
      build: function (p) {
        return "Check the wrapped asset's peg on " + p.name + ' once a week; a depeg is a reason to exit.';
      },
    },
    {
      test: has('index'),
      build: function (p) {
        return 'Check the ' + p.name + ' index composition once a week; a rebalance is a reason to re-read the weights.';
      },
    },
    {
      test: has('governance'),
      build: function (p) {
        return 'Check ' + p.name + "'s open proposals once a week and vote on any that touch your lock.";
      },
    },
    {
      test: has('card'),
      build: function (p) {
        return 'Check the ' + p.name + ' card balance and its limits once a week.';
      },
    },
    {
      test: has('cedefi'),
      build: function (p) {
        return 'Check the managed position and fees ' + p.name + ' reports once a week.';
      },
    },
  ];

  function monitorFor(p) {
    var rule = firstMatching(MONITOR_ACTIONS, (p.category || '').toLowerCase());
    var points =
      ' If ' +
      p.name +
      ' publishes a points or rewards page, confirm the position is counted there; if it publishes none, the on-chain position is the record.';
    if (rule) return rule.build(p) + points;
    return (
      'Check the position ' +
      p.name +
      ' shows for your wallet once a week; a position that stops counting is a reason to re-read its rules.' +
      points
    );
  }

  // How to leave, by category — the unwind first, the claim second, and
  // never a fee to claim.
  var EXIT_ACTIONS = [
    {
      test: has('lend', 'cdp', 'collateral'),
      build: function (p) {
        return 'Repay any borrow on ' + p.name + ' first, then withdraw the supply.';
      },
    },
    {
      test: has('dex', 'yield', 'leveraged farm'),
      build: function (p) {
        return 'Remove the liquidity from ' + p.name + "'s pool and collect the fees.";
      },
    },
    {
      test: has('interest rate'),
      build: function (p) {
        return 'Let the fixed term on ' + p.name + ' mature, then withdraw.';
      },
    },
    {
      test: has('perpetual', 'derivative'),
      build: function (p) {
        return 'Close the hedge on ' + p.name + ' and withdraw the margin.';
      },
    },
    {
      test: has('bridge'),
      build: function (p) {
        return 'Bridge the funds back through ' + p.name + ' to your starting chain.';
      },
    },
    {
      test: has('staking', 'restak'),
      build: function (p) {
        return 'Unstake through ' + p.name + ' and wait out its unbonding period.';
      },
    },
    {
      test: has('prediction'),
      build: function (p) {
        return 'Settle the open market position on ' + p.name + ' and withdraw.';
      },
    },
    {
      test: has('yield', 'curator', 'allocator'),
      build: function (p) {
        return 'Redeem the vault shares on ' + p.name + ' and withdraw.';
      },
    },
    {
      test: has('stable'),
      build: function (p) {
        return 'Redeem the stable asset through ' + p.name + ' back to USDC.';
      },
    },
    {
      test: has('rwa'),
      build: function (p) {
        return 'Redeem the yield asset through ' + p.name + '.';
      },
    },
    {
      test: has('insurance'),
      build: function (p) {
        return 'Let the cover on ' + p.name + ' expire or cancel it, then withdraw.';
      },
    },
    {
      test: has('payment'),
      build: function (p) {
        return 'Close the ' + p.name + ' channel and settle the balance back to your wallet.';
      },
    },
    {
      test: is('chain'),
      build: function (p) {
        return 'Undelegate from ' + p.name + ' and wait out its unbonding period.';
      },
    },
    {
      test: has('btc'),
      build: function (p) {
        return 'Unwrap the asset through ' + p.name + ' back to BTC.';
      },
    },
    {
      test: has('index'),
      build: function (p) {
        return 'Sell the ' + p.name + ' index position back to USDC.';
      },
    },
    {
      test: has('governance'),
      build: function (p) {
        return 'Unlock the governance asset on ' + p.name + ' once the lock ends.';
      },
    },
    {
      test: has('card'),
      build: function (p) {
        return 'Spend down or withdraw the ' + p.name + ' card balance.';
      },
    },
    {
      test: has('cedefi'),
      build: function (p) {
        return 'Withdraw the managed position from ' + p.name + '.';
      },
    },
  ];

  function exitFor(p) {
    var rule = firstMatching(EXIT_ACTIONS, (p.category || '').toLowerCase());
    var claim =
      ' Claim only from the link ' + p.name + ' itself publishes, and never pay a fee to claim.';
    if (rule) return rule.build(p) + claim;
    return 'Withdraw the position from ' + p.name + '.' + claim;
  }

  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }

  function farmSteps(p) {
    var chain = chainOf(p);
    var family = chainFamily(chain);
    var capital = capitalFor(p);
    var half = Math.max(10, Math.floor(capital / 2));
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(family, capital);
    var reserve = family === 'Solana' ? 1 : 5;
    return [
      {
        text: walletFor(family, chain),
        cost: 'under $3 of gas for the first transaction',
        time: '5 minutes',
      },
      {
        text: 'Move $' + capital + ' of USDC to your farm wallet on ' + chain + ' and keep $' + reserve + ' aside for gas on that chain.',
        cost: '$' + capital + ' of capital and about $' + gas + ' of gas',
        time: '10 minutes to fund',
      },
      {
        text: actionFor(p, capital, chain),
        cost: '$' + capital + ' of capital and about $' + gas + ' of gas',
        time: '15 minutes to set up',
      },
      {
        text: secondActionFor(p, half),
        cost: '$' + half + ' of capital and about $3 of gas',
        time: '15 minutes',
      },
      { text: weeklyFor(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      {
        text: monitorFor(p),
        cost: 'no fee to check',
        time: '5 minutes a week',
      },
      {
        text: 'Hold the position for at least ' + hold + ' days ' + holdReason(p.age_days) + '.',
        cost: 'the $' + capital + ' stays in the position',
        time: hold + ' days',
      },
      {
        text: exitFor(p),
        cost: 'no fee to claim, and never pay to claim',
        time: '10 minutes',
      },
      {
        text:
          'Write the wallet, the ' +
          chain +
          ' chain, the ' +
          (p.category || 'uncategorised') +
          ' position, the dates and every transaction hash in a farm log so you can repeat the position or unwind it.',
        cost: 'nothing but the log',
        time: '5 minutes',
      },
    ].map(stepText);
  }

  // -------------------------------------------------------------------------
  // 4. The DOM helper: el(tag, attrs, ...children).
  // -------------------------------------------------------------------------
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        child.forEach(function (c) {
          if (c) node.appendChild(c);
        });
      } else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // -------------------------------------------------------------------------
  // 5. Hash routing: #/protocol/<slug> opens a detail view;
  //    #/?q=&category=&chain=&tvl= carries filters.
  // -------------------------------------------------------------------------
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    state.selected = null;
    if (hash.indexOf('/protocol/') === 0) {
      var rest = hash.slice('/protocol/'.length);
      var qi = rest.indexOf('?');
      state.selected = decodeURIComponent(qi >= 0 ? rest.slice(0, qi) : rest);
      if (qi >= 0) readParams(new URLSearchParams(rest.slice(qi + 1)));
      return;
    }
    if (hash.charAt(0) === '/') hash = hash.slice(1);
    if (hash.charAt(0) === '?') readParams(new URLSearchParams(hash.slice(1)));
    else if (hash) readParams(new URLSearchParams(hash));
  }

  function readParams(params) {
    if (params.get('q') !== null) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tvl')) state.tvl = parseInt(params.get('tvl'), 10) || 0;
    if (params.get('tab')) state.tab = params.get('tab');
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tvl) params.set('tvl', String(state.tvl));
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    var next;
    if (state.selected) {
      next = '#/protocol/' + encodeURIComponent(state.selected) + (params.toString() ? '?' + params.toString() : '');
    } else {
      next = params.toString() ? '#/?' + params.toString() : '#/';
    }
    if (window.location.hash !== next) window.history.replaceState(null, '', next);
  }

  // -------------------------------------------------------------------------
  // 6. Filtering and sorting the board.
  // -------------------------------------------------------------------------
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (state.tvl && r.tvl_usd < state.tvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortValue(r, key) {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null ? Infinity : r.age_days;
    return r.implied_value_usd;
  }

  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av = sortValue(a, key);
      var bv = sortValue(b, key);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // -------------------------------------------------------------------------
  // 7a. Header and lede: brand, snapshot facts, the top-5 spotlight.
  // -------------------------------------------------------------------------
  function header() {
    return el(
      'header',
      { class: 'top' },
      el(
        'div',
        { class: 'brand' },
        el('span', { class: 'mark' }),
        el('span', { class: 'brand-name', text: 'Token Radar · radar-3' }),
      ),
      el(
        'div',
        { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' }),
      ),
    );
  }

  function top5Cards() {
    return DATA.rows.slice(0, 5).map(function (r) {
      return el(
        'a',
        { class: 'top5-card', href: '#/protocol/' + encodeURIComponent(r.slug) },
        el('span', { class: 'top5-rank', text: '#' + r.rank }),
        el('b', { text: r.name }),
        el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
      );
    });
  }

  function factsPanel() {
    return el(
      'div',
      { class: 'facts' },
      el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
      el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
      el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
      el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) })),
      el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: fmtUsd(DATA.rows[0].implied_value_usd) })),
    );
  }

  function lede() {
    return el(
      'section',
      { class: 'lede' },
      el(
        'div',
        null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el(
          'p',
          {
            text:
              'The watchlist is the floor: every protocol with at least $' +
              Math.round(DATA.floor_usd / 1e6) +
              'M of TVL and no token on record. The early radar adds ' +
              DATA.early_size +
              ' pre-token protocols below that floor, by TVL. Implied value is a model, not a promise — and never a prediction that a token will launch.',
          },
        ),
        el('div', { class: 'top5' }, top5Cards()),
      ),
      factsPanel(),
    );
  }

  // -------------------------------------------------------------------------
  // 7b. Controls: search, category, chain, minimum TVL, and the token tab.
  // -------------------------------------------------------------------------
  function categoryOptions() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    return categories.map(function (c) {
      return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null });
    });
  }

  function chainOptions() {
    var chainCounts = {};
    DATA.rows.forEach(function (r) {
      (r.chains || []).forEach(function (c) {
        chainCounts[c] = (chainCounts[c] || 0) + 1;
      });
    });
    var chains = Object.keys(chainCounts)
      .sort(function (a, b) {
        return chainCounts[b] - chainCounts[a];
      })
      .slice(0, 12);
    return chains.map(function (c) {
      return el('option', { value: c, text: c + ' (' + chainCounts[c] + ')', selected: c === state.chain ? 'selected' : null });
    });
  }

  function tvlOptions() {
    return [
      [0, 'Any TVL'],
      [1e7, 'TVL $10M+'],
      [5e7, 'TVL $50M+'],
      [1e8, 'TVL $100M+'],
      [5e8, 'TVL $500M+'],
      [1e9, 'TVL $1B+'],
    ].map(function (o) {
      return el('option', { value: String(o[0]), text: o[1], selected: state.tvl === o[0] ? 'selected' : null });
    });
  }

  function controls() {
    var search = el('input', {
      type: 'search',
      id: 'q',
      placeholder: 'Search name, category or chain',
      value: state.q,
      'aria-label': 'Search the board',
    });
    search.addEventListener('input', function () {
      state.q = search.value;
      writeHash();
      render();
    });
    var select = el(
      'select',
      { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categoryOptions(),
    );
    select.addEventListener('change', function () {
      state.category = select.value;
      writeHash();
      render();
    });
    var chainSel = el(
      'select',
      { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chainOptions(),
    );
    chainSel.addEventListener('change', function () {
      state.chain = chainSel.value;
      writeHash();
      render();
    });
    var tvlSel = el('select', { id: 'tvl', 'aria-label': 'Minimum TVL' }, tvlOptions());
    tvlSel.addEventListener('change', function () {
      state.tvl = parseInt(tvlSel.value, 10) || 0;
      writeHash();
      render();
    });
    var pre = el('button', {
      type: 'button',
      'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false',
      text: 'Pre-token',
      onclick: function () {
        state.tab = 'pre-token';
        writeHash();
        render();
      },
    });
    var live = el('button', {
      type: 'button',
      'aria-pressed': state.tab === 'live' ? 'true' : 'false',
      text: 'Already launched',
      onclick: function () {
        state.tab = 'live';
        writeHash();
        render();
      },
    });
    var countText =
      state.tab === 'pre-token'
        ? filteredRows().length + ' of ' + DATA.board_size + ' rows shown'
        : DATA.live.length + ' live-token protocols, excluded from the ranking';
    return el(
      'div',
      { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'tvl', text: 'Minimum TVL' }), tvlSel),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: countText }),
    );
  }

  // -------------------------------------------------------------------------
  // 7c. The board table, with sortable headers and one row per protocol.
  // -------------------------------------------------------------------------
  function sortHeader(key, label) {
    return el(
      'th',
      { scope: 'col' },
      el(
        'button',
        {
          type: 'button',
          onclick: function () {
            if (state.sort === key) state.dir = -state.dir;
            else {
              state.sort = key;
              state.dir = -1;
            }
            render();
          },
        },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null,
      ),
    );
  }

  function protocolCell(r) {
    var chains = r.chains || [];
    var sub =
      (r.category || 'Other') +
      ' on ' +
      (chains.length ? chains.slice(0, 2).join(', ') : 'an unnamed chain') +
      (chains.length > 2 ? ' +' + (chains.length - 2) : '');
    return el(
      'td',
      null,
      el(
        'div',
        { class: 'name' },
        el('a', { class: 'row-link', href: '#/protocol/' + encodeURIComponent(r.slug), text: r.name }),
        el('span', { class: 'sub', text: sub }),
      ),
    );
  }

  function boardRowNode(r, max) {
    var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
    var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    return el(
      'tr',
      {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () {
          openDetail(r.slug);
        },
        onkeydown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDetail(r.slug);
          }
        },
      },
      el('td', { class: 'num', text: String(r.rank) }),
      protocolCell(r),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num ' + growthClass, text: growth }),
      el('td', { class: 'num', text: fmtAge(r.age_days) }),
      el(
        'td',
        null,
        el(
          'div',
          { class: 'implied' },
          el(
            'div',
            { class: 'bar', 'aria-hidden': 'true' },
            el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' }),
          ),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
        ),
      ),
      el('td', null, el('span', { class: 'status', text: 'no token' })),
    );
  }

  function emptyBoard() {
    return el(
      'div',
      { class: 'panel' },
      el(
        'div',
        { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', {
          class: 'button primary',
          type: 'button',
          text: 'Clear filters',
          onclick: function () {
            state.q = '';
            state.category = 'all';
            state.chain = 'all';
            state.tvl = 0;
            writeHash();
            render();
          },
        }),
      ),
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) return emptyBoard();
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(boardRowNode(r, max));
    });
    return el(
      'div',
      { class: 'panel' },
      el(
        'div',
        { class: 'table-wrap' },
        el(
          'table',
          null,
          el('caption', {
            class: 'sub',
            text: 'Pre-token protocols, strongest implied value first. Select a row — or follow its link — for its model and farm plan.',
          }),
          el(
            'thead',
            null,
            el(
              'tr',
              null,
              sortHeader('implied', 'Rank'),
              sortHeader('name', 'Protocol'),
              sortHeader('tvl', 'TVL'),
              sortHeader('growth', '7d'),
              sortHeader('age', 'Age'),
              sortHeader('implied', 'Implied value'),
              el('th', { scope: 'col', text: 'Token' }),
            ),
          ),
          tbody,
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // 7d. The live table: protocols that already trade, set aside from the
  //     ranking — their market cap is a fact, not a model.
  // -------------------------------------------------------------------------
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var chains = r.chains || [];
      tbody.appendChild(
        el(
          'tr',
          null,
          el('td', { class: 'num', text: 'live' }),
          el(
            'td',
            null,
            el(
              'div',
              { class: 'name' },
              el('b', { text: r.name }),
              el(
                'span',
                {
                  class: 'sub',
                  text:
                    (r.category || 'Other') +
                    ' on ' +
                    (chains.length ? chains.slice(0, 2).join(', ') : 'an unnamed chain'),
                },
              ),
            ),
          ),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', {
            class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'),
            text: fmtPct(r.change_7d),
          }),
          el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
          el('td', null, el('span', { class: 'status', text: 'already trades' })),
        ),
      );
    });
    return el(
      'div',
      { class: 'panel' },
      el(
        'div',
        { class: 'table-wrap' },
        el(
          'table',
          null,
          el('caption', {
            class: 'sub',
            text: 'Already launched — excluded: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.',
          }),
          el(
            'thead',
            null,
            el(
              'tr',
              null,
              el('th', { scope: 'col', text: 'Status' }),
              el('th', { scope: 'col', text: 'Protocol' }),
              el('th', { scope: 'col', text: 'TVL' }),
              el('th', { scope: 'col', text: '7d' }),
              el('th', { scope: 'col', text: 'Market cap' }),
              el('th', { scope: 'col', text: 'Token' }),
            ),
          ),
          tbody,
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // 7e. The model panel: the formula, in words, under the board.
  // -------------------------------------------------------------------------
  function modelPanel() {
    var m = DATA.model;
    return el(
      'section',
      { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', {
        class: 'sub',
        text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.',
      }),
      el(
        'div',
        { class: 'formula' },
        'implied = round( tvl_usd x ' +
          m.base_multiple +
          ' x (1 + clamp(change_7d, ' +
          m.growth_floor +
          ', ' +
          m.growth_cap +
          ') / 100 x ' +
          m.growth_weight +
          ') x maturity(age_days) x chain x category x standing )',
      ),
      el('p', {
        class: 'sub',
        text:
          'Maturity: ' +
          m.maturity_floor +
          ' at birth, rising to ' +
          m.maturity_peak +
          ' at ' +
          m.maturity_peak_days +
          ' days, easing to ' +
          m.maturity_late +
          ' after ' +
          m.maturity_days +
          ' days — a token is likeliest while the protocol is proven but still young; a three-year tokenless run signals a team that will never launch. Standing: ' +
          m.standing_floor +
          ' + ' +
          m.standing_range +
          ' x the protocol’s TVL rank within its own category on this board, so the category leader scores the full premium and the smallest a small discount.',
      }),
      el('p', {
        class: 'sub',
        text:
          'Chain: 1 + 0.025 per extra chain, to 1.20. Category: Dexs, Lending and CDP x1.08, Yield x1.06, Derivatives, Risk Curators, Allocators and Liquidity Manager x1.05, Yield Aggregator, Basis Trading, Leveraged Farming and Farm x1.04, RWA x1.02, unlisted x1.00, no category x0.97, Liquid Staking, Staking Pool, Restaking and Liquid Restaking x0.92, Bridge x0.90. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' +
          m.unknown_age_days +
          ' days.',
      }),
    );
  }

  // -------------------------------------------------------------------------
  // 7f. The detail dialog: one protocol's model breakdown and farm plan.
  // -------------------------------------------------------------------------
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () {
    if (state.selected) {
      state.selected = null;
      writeHash();
    }
  });

  function equationRows(row) {
    return [
      ['TVL', fmtUsd(row.tvl_usd)],
      ['Seven-day growth', fmtPct(row.change_7d)],
      ['Age with no token', fmtAge(row.age_days)],
      ['Chains (' + (row.chains || []).length + ')', 'x' + row.chain_multiplier],
      ['Category (' + (row.category || 'none') + ')', 'x' + row.category_multiplier],
      ['Standing in category', 'x' + row.standing_multiplier],
      ['Growth multiplier', String(row.growth_multiplier)],
      ['Maturity multiplier', String(row.maturity_multiplier)],
      ['Implied value', fmtUsd(row.implied_value_usd)],
    ].map(function (pair) {
      return el('div', null, el('span', { text: pair[0] }), el('b', { class: 'num', text: pair[1] }));
    });
  }

  function detailHead(row) {
    return el(
      'div',
      { class: 'detail-head' },
      el(
        'div',
        null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', {
          class: 'sub',
          text:
            (row.category || 'Other') +
            ' on ' +
            (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain'),
        }),
      ),
      el('button', {
        class: 'close',
        type: 'button',
        'aria-label': 'Close details',
        text: 'Close',
        onclick: function () {
          dialog.close();
        },
      }),
    );
  }

  function detailModel(row) {
    var recomputed = impliedOf(row, DATA.model);
    var verdict =
      recomputed === row.implied_value_usd
        ? ', the same number board.json carries.'
        : ', which differs from the board: the data would be stale.';
    return el(
      'section',
      { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' }, equationRows(row)),
      el('p', {
        class: 'sub',
        text:
          'Model ' +
          DATA.model_version +
          ': the same function scores every protocol. The page recomputes this row as ' +
          fmtUsd(recomputed) +
          verdict +
          ' This is an estimate, not a price. Link: #/protocol/' +
          row.slug,
      }),
    );
  }

  function detailFarm(row) {
    var steps = farmSteps(row);
    return el(
      'section',
      { class: 'detail-section' },
      el('h3', { text: 'Farm plan — 9 steps' }),
      el(
        'ol',
        { class: 'steps' },
        steps.map(function (s) {
          var at = s.indexOf(' Cost: ');
          var action = at >= 0 ? s.slice(0, at) : s;
          var tail = at >= 0 ? s.slice(at + 1) : '';
          return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
        }),
      ),
    );
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) {
      return r.slug === slug;
    })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    dialog.appendChild(detailHead(row));
    dialog.appendChild(detailModel(row));
    dialog.appendChild(detailFarm(row));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // -------------------------------------------------------------------------
  // 8. Render and boot: header, lede, controls, the active table, the model
  //    panel; the dialog rides along and opens when the hash names a row.
  // -------------------------------------------------------------------------
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    else if (dialog.open) dialog.close();
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () {
    readHash();
    render();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
