import numpy as np


def make_windows(arr: np.ndarray, encoder_len: int, horizon: int):
    """
    arr: [T_total, F] normalised feature matrix for ONE tenant.
    Yields (x_window, y_window) pairs. The future values ARE the labels —
    this is why the system self-improves as time passes: every elapsed week
    turns a prediction into a labelled training example.
    """
    T = arr.shape[0]
    last_start = T - (encoder_len + horizon)
    for s in range(0, max(last_start + 1, 0)):
        x = arr[s : s + encoder_len]
        y = arr[s + encoder_len : s + encoder_len + horizon]
        yield x, y
