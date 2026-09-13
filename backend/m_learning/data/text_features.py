import numpy as np


def weekly_text_features(week_embeddings: np.ndarray,
                         baseline_centroid: np.ndarray | None,
                         sentiments: list[float]) -> dict:
    """
    week_embeddings   : [n_messages, emb_dim] for this week (from Qdrant)
    baseline_centroid : rolling 8-week mean centroid, or None on first weeks
    sentiments        : per-message sentiment scores in [-1, 1]
    """
    out = {"sentiment_mean": 0.0, "sentiment_std": 0.0, "topic_drift": 0.0}
    if sentiments:
        out["sentiment_mean"] = float(np.mean(sentiments))
        out["sentiment_std"]  = float(np.std(sentiments))
    if week_embeddings is not None and len(week_embeddings) and \
       baseline_centroid is not None:
        c = week_embeddings.mean(axis=0)
        c = c / (np.linalg.norm(c) + 1e-9)
        b = baseline_centroid / (np.linalg.norm(baseline_centroid) + 1e-9)
        out["topic_drift"] = float(1.0 - np.dot(c, b))   # cosine distance
    return out


def update_baseline(prev_centroid, week_centroid, window: int = 8):
    if prev_centroid is None:
        return week_centroid
    alpha = 1.0 / window
    return (1 - alpha) * prev_centroid + alpha * week_centroid


def attach_text_features(df, weekly_embeddings: dict, weekly_sentiments: dict):
    """Attach Family 5 columns to a weekly feature frame.

    weekly_embeddings : {week -> [n_messages, emb_dim]}
    weekly_sentiments : {week -> list[float]}

    The baseline is advanced strictly forward in time, so a week's drift is
    measured against only the weeks before it. Whatever happens next week does not affect the current week's drift. This is important for the model to learn the actual drift of a week, and not be influenced by future weeks. The baseline is updated only if there are embeddings for the current week, so that weeks with no messages do not affect the baseline. This ensures that the baseline is always based on actual data and not on missing data.
    """
    import pandas as pd

    baseline = None
    rows = []
    for week in df.index:
        embeddings = weekly_embeddings.get(week)
        sentiments = weekly_sentiments.get(week, [])
        rows.append(weekly_text_features(embeddings, baseline, sentiments))

        if embeddings is not None and len(embeddings):
            centroid = np.asarray(embeddings).mean(axis=0)
            baseline = update_baseline(baseline, centroid)

    text_df = pd.DataFrame(rows, index=df.index)
    out = df.copy()
    for column in text_df.columns:
        out[column] = text_df[column]
    return out
