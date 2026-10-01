"""Compute forward metrics from sourced, period-aligned inputs; never invent estimates."""
from datetime import date
from math import isfinite


def calculate(rec, as_of):
    block = rec.get('forward', {})
    issues = []
    cutoff = date.fromisoformat(as_of)

    def number(group, key):
        leaf = block.get(group, {}).get(key, {})
        value = leaf.get('value')
        try:
            age = (cutoff - date.fromisoformat(leaf['as_of'])).days
            valid = bool(leaf.get('source')) and 0 <= age <= 120
        except (KeyError, TypeError, ValueError):
            valid = False
        if not valid or isinstance(value, bool) or not isinstance(value, (float, int)) or not isfinite(value):
            issues.append(f'{group}.{key}: missing, invalid, future-dated or older than 120 days')
            return None
        return value

    def ratio(a, b, scale=1):
        return scale * a / b if a is not None and b is not None and b > 0 else None

    def delta(a, b):
        return a - b if a is not None and b is not None else None

    periods = {}
    for period in ('fy1', 'fy2'):
        x = {k: number(period, k) for k in ('revenue', 'ebit', 'cfo', 'capex', 'eps', 'tax_rate_pct', 'invested_capital_begin', 'invested_capital_end')}
        fcf = x['cfo'] - x['capex'] if x['cfo'] is not None and x['capex'] is not None and x['capex'] >= 0 else None
        ic = (x['invested_capital_begin'] + x['invested_capital_end']) / 2 if x['invested_capital_begin'] is not None and x['invested_capital_end'] is not None else None
        tax = x['tax_rate_pct']
        nopat = x['ebit'] * (1 - tax / 100) if x['ebit'] is not None and tax is not None and 0 <= tax <= 100 else None
        periods[period] = dict(x, fcf=fcf, operating_margin_pct=ratio(x['ebit'], x['revenue'], 100), fcf_margin_pct=ratio(fcf, x['revenue'], 100), roic_pct=ratio(nopat, ic, 100))
    a, b = periods['fy1'], periods['fy2']
    aligned = block.get('periods_aligned') is True
    if not aligned:
        issues.append('periods_aligned must confirm consecutive fiscal years, consistent currency/units/accounting')
    growth = ratio(delta(b['fcf'], a['fcf']), a['fcf'], 100) if b['fcf'] is not None and b['fcf'] > 0 else None
    eps_growth = ratio(delta(b['eps'], a['eps']), a['eps'], 100) if b['eps'] is not None and b['eps'] > 0 else None
    price = number('valuation', 'price')
    pe = ratio(price, a['eps']) if price is not None and price > 0 else None
    ev = number('valuation', 'enterprise_value')
    u, d, n = [number('revisions', k) for k in ('up_30d', 'down_30d', 'analysts')]
    breadth = (u-d)/n*100 if all(x is not None and x >= 0 and int(x) == x for x in (u,d,n)) and n > 0 and u+d <= n else None
    buy, hold, sell = [number('ratings', k) for k in ('buy', 'hold', 'sell')]
    ratings = 100*buy/(buy+hold+sell) if all(x is not None and x >= 0 and int(x) == x for x in (buy,hold,sell)) and buy+hold+sell > 0 else None
    wacc = number('valuation', 'wacc_pct')
    metrics = {
        'analyst_buy_pct': ratings,
        'operating_margin_expansion_pp': delta(b['operating_margin_pct'], a['operating_margin_pct']) if aligned else None,
        'fcf_margin_expansion_pp': delta(b['fcf_margin_pct'], a['fcf_margin_pct']) if aligned else None,
        'fcf_growth_pct': growth if aligned else None,
        'forward_roic_pct': a['roic_pct'] if aligned else None,
        'roic_wacc_spread_pp': delta(a['roic_pct'], wacc) if aligned else None,
        'eps_revision_breadth_pct': breadth,
        'peg': ratio(pe, eps_growth) if aligned else None,
        'ev_fcf': ratio(ev, a['fcf']) if aligned and ev is not None and ev > 0 else None,
    }
    # Six independent checkpoints; correlated growth/margin and ROIC/spread counted together.
    checks = {
        'analyst_support': None if ratings is None else ratings >= 60,
        'operating_leverage': None if metrics['operating_margin_expansion_pp'] is None else metrics['operating_margin_expansion_pp'] > 0,
        'cash_compounding': None if not aligned or growth is None or metrics['fcf_margin_expansion_pp'] is None else growth >= 15 and metrics['fcf_margin_expansion_pp'] >= 0,
        'value_creation': None if metrics['roic_wacc_spread_pp'] is None else metrics['roic_wacc_spread_pp'] >= 3,
        'revisions': None if breadth is None else breadth > 0,
        'valuation': None if metrics['peg'] is None else metrics['peg'] <= 2,
    }
    return {'metrics': metrics, 'periods': periods, 'checks': checks,
            'passed': sum(x is True for x in checks.values()), 'covered': sum(x is not None for x in checks.values()),
            'issues': issues, 'fcf_transition': 'not_comparable' if not aligned else ('crossing_positive' if a['fcf'] is not None and b['fcf'] is not None and a['fcf'] <= 0 < b['fcf'] else 'see_periods')}
