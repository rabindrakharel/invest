"""The fixed series catalog for the macro-data skill (read by macro-regime).

Every series the regime engine reads is listed here once, with its source, pillar and
frequency.  fetch_macro.py downloads exactly this list; compute_regime.py reads only
what this list names.  Add a series here, never inline in either script.

Sources
  fred   https://fred.stlouisfed.org/graph/fredgraph.csv?id=<ID>   (no API key)
  yahoo  https://query1.finance.yahoo.com/v8/finance/chart/<SYM>   (daily, 10y)
"""
from __future__ import annotations

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={id}"
FRED_PAGE = "https://fred.stlouisfed.org/series/{id}"
YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range={range}&interval={interval}"
YAHOO_PAGE = "https://finance.yahoo.com/quote/{sym}"

# id, name, pillar, frequency
FRED: list[tuple[str, str, str, str]] = [
    # Rates and duration
    ("DGS3MO", "3-month Treasury yield", "rates", "d"),
    ("DGS2", "2-year Treasury yield", "rates", "d"),
    ("DGS5", "5-year Treasury yield", "rates", "d"),
    ("DGS10", "10-year Treasury yield", "rates", "d"),
    ("DGS30", "30-year Treasury yield", "rates", "d"),
    ("DFII10", "10-year TIPS real yield", "rates", "d"),
    ("T10Y2Y", "10y minus 2y spread", "rates", "d"),
    ("T10Y3M", "10y minus 3m spread", "rates", "d"),
    ("THREEFYTP10", "10-year term premium (Kim-Wright)", "rates", "d"),
    ("DFF", "Effective fed funds rate", "rates", "d"),
    ("DFEDTARU", "Fed funds target, upper", "rates", "d"),
    ("DFEDTARL", "Fed funds target, lower", "rates", "d"),
    ("SOFR", "Secured overnight financing rate", "liquidity", "d"),
    ("IORB", "Interest on reserve balances", "liquidity", "d"),
    # Credit
    ("BAMLC0A0CM", "Investment-grade OAS", "credit", "d"),
    ("BAMLH0A0HYM2", "High-yield OAS", "credit", "d"),
    ("BAMLH0A3HYC", "CCC and lower OAS", "credit", "d"),
    ("BAA10Y", "Moody's Baa minus 10y", "credit", "d"),
    ("DRTSCILM", "SLOOS: net % tightening C&I loans, large firms", "credit", "q"),
    # Volatility and stress
    ("VIXCLS", "Cboe VIX", "vol", "d"),
    ("NFCI", "Chicago Fed National Financial Conditions Index", "liquidity", "w"),
    ("STLFSI4", "St. Louis Fed Financial Stress Index", "liquidity", "w"),
    # Liquidity and money
    ("WALCL", "Fed total assets (millions)", "liquidity", "w"),
    ("WTREGEN", "Treasury General Account (millions)", "liquidity", "w"),
    ("RRPONTSYD", "Overnight reverse repo (billions)", "liquidity", "d"),
    ("WRESBAL", "Reserve balances (millions)", "liquidity", "w"),
    ("M2SL", "M2 money stock", "liquidity", "m"),
    ("DTWEXBGS", "Broad trade-weighted dollar", "liquidity", "d"),
    # Growth and labour
    ("ICSA", "Initial jobless claims", "growth", "w"),
    ("CCSA", "Continuing claims", "growth", "w"),
    ("UNRATE", "Unemployment rate", "growth", "m"),
    ("PAYEMS", "Nonfarm payrolls (thousands)", "growth", "m"),
    ("SAHMREALTIME", "Sahm rule recession indicator", "growth", "m"),
    ("GDPNOW", "Atlanta Fed GDPNow", "growth", "q"),
    ("CFNAI", "Chicago Fed National Activity Index", "growth", "m"),
    ("INDPRO", "Industrial production", "growth", "m"),
    ("RSAFS", "Retail sales", "growth", "m"),
    ("UMCSENT", "UMich consumer sentiment", "growth", "m"),
    ("JTSJOL", "JOLTS job openings", "growth", "m"),
    ("RECPROUSM156N", "Smoothed recession probability", "growth", "m"),
    # Inflation
    ("CPIAUCSL", "CPI, all items", "inflation", "m"),
    ("CPILFESL", "Core CPI", "inflation", "m"),
    ("PCEPILFE", "Core PCE price index", "inflation", "m"),
    ("T10YIE", "10-year breakeven inflation", "inflation", "d"),
    ("T5YIFR", "5y5y forward inflation expectation", "inflation", "d"),
    ("DCOILWTICO", "WTI crude", "inflation", "d"),
    ("DCOILBRENTEU", "Brent crude", "inflation", "d"),
    # Housing and mortgages
    ("MORTGAGE30US", "Freddie Mac 30-year mortgage rate", "housing", "w"),
    ("HOUST", "Housing starts", "housing", "m"),
    ("PERMIT", "Building permits", "housing", "m"),
    ("HSN1F", "New home sales", "housing", "m"),
    ("MSACSR", "Months supply of new homes", "housing", "m"),
    ("EXHOSLUSM495S", "Existing home sales", "housing", "m"),
    ("CSUSHPINSA", "Case-Shiller national home price index", "housing", "m"),
    ("WSHOMCB", "Fed MBS holdings (millions)", "housing", "w"),
    # Fiscal
    ("A091RC1Q027SBEA", "Federal interest payments (SAAR, billions)", "fiscal", "q"),
    ("GFDEBTN", "Federal debt, total public (millions)", "fiscal", "q"),
    # Long history, monthly, for the analog engine
    ("GS10", "10-year yield, monthly", "history", "m"),
    ("TB3MS", "3-month bill, monthly", "history", "m"),
    ("FEDFUNDS", "Fed funds, monthly", "history", "m"),
    ("BAA", "Moody's Baa yield, monthly", "history", "m"),
    ("WTISPLC", "WTI spot, monthly", "history", "m"),
    ("SPASTT01USM661N", "US share prices (OECD, monthly)", "history", "m"),
]

# symbol, name, group
YAHOO: list[tuple[str, str, str]] = [
    ("^MOVE", "ICE BofA MOVE index (Treasury implied vol)", "vol"),
    ("^VIX", "Cboe VIX", "vol"),
    ("^VIX3M", "Cboe 3-month VIX", "vol"),
    ("^VVIX", "Vol of VIX", "vol"),
    ("^SKEW", "Cboe SKEW", "vol"),
    ("DX-Y.NYB", "US dollar index (DXY)", "fx"),
    ("JPY=X", "USD/JPY", "fx"),
    ("CL=F", "WTI front month", "commodity"),
    ("BZ=F", "Brent front month", "commodity"),
    ("NG=F", "Henry Hub natural gas", "commodity"),
    ("GC=F", "Gold", "commodity"),
    ("HG=F", "Copper", "commodity"),
    ("BTC-USD", "Bitcoin", "crypto"),
    ("^GSPC", "S&P 500", "index"),
    ("SPY", "S&P 500 ETF", "index"),
    ("RSP", "S&P 500 equal weight", "index"),
    ("QQQ", "Nasdaq-100", "index"),
    ("IWM", "Russell 2000", "index"),
    ("TLT", "20+ year Treasuries", "bonds"),
    ("IEF", "7-10 year Treasuries", "bonds"),
    ("SHY", "1-3 year Treasuries", "bonds"),
    ("TIP", "TIPS", "bonds"),
    ("HYG", "High-yield corporates", "bonds"),
    ("LQD", "Investment-grade corporates", "bonds"),
    ("MBB", "Agency MBS", "bonds"),
    ("XLK", "Technology", "sector"),
    ("XLC", "Communication services", "sector"),
    ("XLY", "Consumer discretionary", "sector"),
    ("XLP", "Consumer staples", "sector"),
    ("XLF", "Financials", "sector"),
    ("XLE", "Energy", "sector"),
    ("XLV", "Health care", "sector"),
    ("XLI", "Industrials", "sector"),
    ("XLB", "Materials", "sector"),
    ("XLU", "Utilities", "sector"),
    ("XLRE", "Real estate", "sector"),
    ("MTUM", "Momentum factor", "factor"),
    ("VLUE", "Value factor", "factor"),
    ("QUAL", "Quality factor", "factor"),
    ("USMV", "Minimum volatility", "factor"),
    ("SPHB", "High beta", "factor"),
    ("SPLV", "Low volatility", "factor"),
    ("ARKK", "Speculative growth", "factor"),
    ("SMH", "Semiconductors", "industry"),
    ("IGV", "Software", "industry"),
    ("KRE", "Regional banks", "industry"),
    ("ITB", "Homebuilders", "industry"),
    ("XBI", "Biotech", "industry"),
    ("GDX", "Gold miners", "industry"),
    ("EEM", "Emerging markets", "international"),
    ("EFA", "Developed ex-US", "international"),
]

SECTORS = [s for s, _, g in YAHOO if g == "sector"]


def fred_url(series_id: str) -> str:
    return FRED_CSV.format(id=series_id)


def fred_page(series_id: str) -> str:
    return FRED_PAGE.format(id=series_id)


def yahoo_page(sym: str) -> str:
    return YAHOO_PAGE.format(sym=sym)


def safe_name(sym: str) -> str:
    """File-system name for a Yahoo symbol: ^VIX -> _VIX, JPY=X -> JPY_X."""
    return sym.replace("^", "_").replace("=", "_").replace("/", "_")
