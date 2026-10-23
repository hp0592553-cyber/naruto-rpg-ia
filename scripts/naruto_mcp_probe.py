"""Verifica initialize, tools/list e tools/call no transporte stdio real."""
import asyncio
import json
import os
import sys
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main():
    params = StdioServerParameters(command=sys.executable,
        args=[str(Path(__file__).with_name("naruto_guarded_mcp.py").resolve())], env=dict(os.environ))
    async with stdio_client(params) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            initialized = await session.initialize()
            definitions = await session.list_tools()
            names = [tool.name for tool in definitions.tools]
            assert set(names) == {"status_rpg", "read_messages", "list_application_commands", "consult_missions"}, names
            result = await session.call_tool("status_rpg", {})
            assert not result.isError, result
            evidence = json.loads(result.content[0].text)
            if evidence.get("status") == "connected":
                for name in ("read_messages", "list_application_commands"):
                    output = await session.call_tool(name, {})
                    assert not output.isError
                    print(json.dumps({"tool": name, "result": json.loads(output.content[0].text)}))
            print(json.dumps({"initialize": initialized.serverInfo.name, "tools": names, "evidence": evidence}))


if __name__ == "__main__":
    asyncio.run(asyncio.wait_for(main(), timeout=100))
