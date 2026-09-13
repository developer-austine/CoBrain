"""Pull country signals on a schedule (Tier 3)."""

from __future__ import annotations

import argparse
from datetime import date

from m_learning.data.external_signals import INDICATORS, fetch_holidays, fetch_world_bank


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh cached country signals")
    parser.add_argument("--countries", nargs="+", required=True)
    parser.add_argument("--years", type=int, default=3)
    args = parser.parse_args()

    this_year = date.today().year
    for country in args.countries:
        for name, indicator in INDICATORS.items():
            series = fetch_world_bank(country, indicator)
            print(f"{country} {name}: {len(series)} annual points")

        for year in range(this_year - args.years + 1, this_year + 2):
            days = fetch_holidays(country, year)
            print(f"{country} holidays {year}: {len(days)}")


if __name__ == "__main__":
    main()
