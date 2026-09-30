"""Disable WeText's implicit network download.

Echo sends already-normalized conversational text with CosyVoice control tokens,
so the frontend is deliberately optional. Raising ImportError makes upstream use
its built-in no-frontend path without blocking startup on ModelScope.
"""
raise ImportError("Echo disables the optional online WeText frontend")
