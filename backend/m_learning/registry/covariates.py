"""Static covariate schema and vocabularies.

Static means constant across the whole series for a tenant. Anything that
changes week to week — author_id, repo_id, channel_id — belongs in the Family 4
dispersion features instead (Section 5).
"""

from dataclasses import dataclass

INDUSTRIES = [
    "unknown",
    "software",
    "fintech",
    "finance",
    "healthcare",
    "education",
    "ecommerce",
    "logistics",
    "media",
    "manufacturing",
    "consulting",
    "nonprofit",
    "government",
    "energy",
    "agriculture",
    "telecom",
]

COUNTRIES = [
    "unknown",
    "KE", "NG", "ZA", "GH", "TZ", "UG", "RW", "EG", "MA",
    "US", "CA", "BR", "MX",
    "GB", "IE", "DE", "FR", "NL", "ES", "IT", "PL", "SE",
    "IN", "SG", "AE", "JP", "CN", "ID", "PH",
    "AU", "NZ",
]

SIZE_BANDS = [
    "unknown",
    "1-10",
    "11-50",
    "51-200",
    "201-500",
    "501-1000",
    "1000+",
]

CURRENCIES = [
    "unknown",
    "KES", "NGN", "ZAR", "GHS", "TZS", "UGX", "RWF", "EGP", "MAD",
    "USD", "CAD", "BRL", "MXN",
    "GBP", "EUR", "PLN", "SEK",
    "INR", "SGD", "AED", "JPY", "CNY", "IDR", "PHP",
    "AUD", "NZD",
]

STATIC_COVARIATES = {
    "industry": INDUSTRIES,
    "country": COUNTRIES,
    "size_band": SIZE_BANDS,
    "currency": CURRENCIES,
}

VOCAB_SIZES = {name: len(values) for name, values in STATIC_COVARIATES.items()}

_INDEX = {
    name: {value: i for i, value in enumerate(values)}
    for name, values in STATIC_COVARIATES.items()
}


@dataclass
class TenantProfile:
    tenant_id: str
    industry: str = "unknown"
    country: str = "unknown"
    size_band: str = "unknown"
    currency: str = "unknown"


def encode_value(covariate: str, value: str | None) -> int:
    """Map a covariate value to its embedding index.

    Unrecognised values fall back to "unknown" (index 0) rather than raising:
    a new tenant with an unlisted country must still be forecastable.
    """
    if covariate not in _INDEX:
        raise KeyError(f"Unknown static covariate: {covariate}")
    if value is None:
        return 0
    return _INDEX[covariate].get(str(value).strip(), 0)


def encode_profile(profile: TenantProfile) -> dict[str, int]:
    return {
        "industry": encode_value("industry", profile.industry),
        "country": encode_value("country", profile.country),
        "size_band": encode_value("size_band", profile.size_band),
        "currency": encode_value("currency", profile.currency),
    }


def decode_value(covariate: str, index: int) -> str:
    values = STATIC_COVARIATES[covariate]
    if 0 <= index < len(values):
        return values[index]
    return values[0]
