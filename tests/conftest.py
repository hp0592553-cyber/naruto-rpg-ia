"""Keep simulated tool calls independent of process-global limiter state."""
import pytest


@pytest.fixture(autouse=True)
def isolate_shared_rate_limiter(monkeypatch):
    # Algorithm tests create their own enabled limiter and fake clock. Tool
    # tests that need a limiter install their own stub within the test.
    # Never carry a real sixty-second cooldown from one unit test to another.
    import discord_py_self_mcp.bot as bot
    import discord_py_self_mcp.tool_utils as tool_utils
    monkeypatch.setattr(bot, "rate_limiter", None)
    monkeypatch.setattr(tool_utils, "rate_limiter", None)
