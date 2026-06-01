#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query"


def main():
    parser = argparse.ArgumentParser(
        description="Atualiza o arquivo market-data.js com indicadores de mercado por marca."
    )
    parser.add_argument("--map", default="tools/brand-market-map.json")
    parser.add_argument("--out", default="outputs/hypercar-duel/market-data.js")
    parser.add_argument("--provider", default="alpha-vantage", choices=["alpha-vantage"])
    parser.add_argument("--require-api-key", action="store_true")
    parser.add_argument("--pause-seconds", type=float, default=13.0)
    args = parser.parse_args()

    api_key = os.environ.get("ALPHA_VANTAGE_API_KEY", "").strip()
    if args.require_api_key and not api_key:
        raise SystemExit("Defina o secret ALPHA_VANTAGE_API_KEY no GitHub antes de rodar.")

    mapping = json.loads(Path(args.map).read_text(encoding="utf-8"))
    indicators = {}
    quoteable = [item for item in mapping if item.get("quoteSymbol")]

    for index, item in enumerate(mapping):
      brand = item["brand"]
      indicator = base_indicator(item)

      if not item.get("quoteSymbol"):
          indicator.update({"status": "not_listed"})
      elif not api_key:
          indicator.update({"status": "missing_api_key"})
      else:
          indicator.update(fetch_alpha_vantage_quote(item["quoteSymbol"], api_key))
          if index < len(quoteable) - 1:
              time.sleep(args.pause_seconds)

      indicators[brand] = indicator

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "provider": "Alpha Vantage GLOBAL_QUOTE",
        "currencyNote": "O preço é exibido na moeda do instrumento listado.",
        "indicators": indicators,
    }
    write_market_data(Path(args.out), payload)
    print(f"Indicadores atualizados: {args.out}")
    print(f"Marcas mapeadas: {len(indicators)}")
    print(f"Marcas com ticker: {sum(1 for item in mapping if item.get('quoteSymbol'))}")


def base_indicator(item):
    return {
        "brand": item.get("brand", ""),
        "marketEntity": item.get("marketEntity", ""),
        "displayTicker": item.get("displayTicker", ""),
        "quoteSymbol": item.get("quoteSymbol", ""),
        "exchange": item.get("exchange", ""),
        "currency": item.get("currency", ""),
        "relationType": item.get("relationType", ""),
        "relationLabel": item.get("relationLabel", ""),
        "price": None,
        "change": None,
        "changePercent": None,
        "latestTradingDay": "",
        "lastUpdated": "",
    }


def fetch_alpha_vantage_quote(symbol, api_key):
    params = urllib.parse.urlencode(
        {"function": "GLOBAL_QUOTE", "symbol": symbol, "apikey": api_key}
    )
    url = f"{ALPHA_VANTAGE_URL}?{params}"
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        return {"status": "error", "error": str(exc)}

    if "Note" in data:
        return {"status": "temporary_unavailable", "error": data.get("Note")}
    if "Information" in data:
        return {"status": "temporary_unavailable", "error": data.get("Information")}

    quote = data.get("Global Quote") or {}
    if not quote:
        return {"status": "no_quote"}

    return {
        "status": "ok",
        "price": to_float(quote.get("05. price")),
        "change": to_float(quote.get("09. change")),
        "changePercent": parse_percent(quote.get("10. change percent")),
        "latestTradingDay": quote.get("07. latest trading day", ""),
        "lastUpdated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_percent(value):
    if not value:
        return None
    return to_float(str(value).replace("%", ""))


def write_market_data(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = (
        "window.MARKET_DATA = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n"
    )
    path.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
