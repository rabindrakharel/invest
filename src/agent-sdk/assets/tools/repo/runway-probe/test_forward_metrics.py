import importlib.util
from pathlib import Path
import tempfile
import json
import unittest
from forward_metrics import calculate

spec = importlib.util.spec_from_file_location('scorecard', Path(__file__).with_name('build-scorecard.py'))
scorecard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scorecard)


def leaf(value):
    return dict(value=value, source='https://example.test/fixture', as_of='2026-09-17')


def record():
    def period(revenue, ebit, cfo, capex, eps):
        return {k: leaf(v) for k, v in dict(revenue=revenue, ebit=ebit, cfo=cfo, capex=capex, eps=eps, tax_rate_pct=20, invested_capital_begin=100, invested_capital_end=100).items()}
    return {'ticker': 'TEST', 'forward': {'periods_aligned': True,
        'fy1': period(100, 20, 30, 10, 2), 'fy2': period(120, 30, 40, 10, 3),
        'valuation': {k: leaf(v) for k,v in dict(price=40, enterprise_value=500, wacc_pct=10).items()},
        'ratings': {k: leaf(v) for k,v in dict(buy=6, hold=3, sell=1).items()},
        'revisions': {k: leaf(v) for k,v in dict(up_30d=5, down_30d=1, analysts=10).items()}}}


class MetricsTest(unittest.TestCase):
    def test_formulas(self):
        result = calculate(record(), '2026-09-17')
        m = result['metrics']
        for k,v in dict(operating_margin_expansion_pp=5, fcf_margin_expansion_pp=5, fcf_growth_pct=50, forward_roic_pct=16, roic_wacc_spread_pp=6, eps_revision_breadth_pct=40, peg=.4, ev_fcf=25).items():
            self.assertAlmostEqual(m[k], v)
        self.assertEqual(result['passed'], 6)

    def test_negative_base(self):
        r = record(); r['forward']['fy1']['cfo'] = leaf(5)
        result = calculate(r, '2026-09-17')
        self.assertIsNone(result['metrics']['fcf_growth_pct'])
        self.assertIsNone(result['metrics']['ev_fcf'])
        self.assertEqual(result['fcf_transition'], 'crossing_positive')

    def test_stale_future_and_unaligned(self):
        r = record(); r['forward']['fy1']['ebit']['as_of'] = '2025-01-01'
        self.assertIsNone(calculate(r, '2026-09-17')['metrics']['forward_roic_pct'])
        self.assertEqual(calculate(record(), '2026-09-16')['covered'], 0)
        r = record(); r['forward']['periods_aligned'] = False
        self.assertIsNone(calculate(r, '2026-09-17')['metrics']['peg'])

    def test_invalid_revision_population(self):
        r = record(); r['forward']['revisions']['up_30d'] = leaf(11)
        self.assertIsNone(calculate(r, '2026-09-17')['metrics']['eps_revision_breadth_pct'])

    def test_unknown_insiders_and_duplicate_buyers(self):
        self.assertFalse(scorecard.insider_pts({}, 10)[2])
        trade = dict(name='A', role='CEO', usd=100, transaction_code='P', open_market=True, form4='https://example.test/form4')
        r = {'insiders': {'coverage_complete': leaf(True), 'buys_90d': leaf([trade]*3)}}
        self.assertEqual(scorecard.insider_pts(r, 10)[0], 4)

    def test_end_to_end_rerun(self):
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder)
            (p/'TEST.json').write_text(json.dumps(record()))
            (p/'_manifest.json').write_text(json.dumps({'price_date':'2026-09-17'}))
            (p/'verdicts.json').write_text('[]')
            scorecard.build(p)
            first = (p/'scorecard.json').read_text()
            scorecard.build(p)
            self.assertEqual(first, (p/'scorecard.json').read_text())
            self.assertEqual(len(json.loads(first)['rows']), 1)

if __name__ == '__main__':
    unittest.main()
