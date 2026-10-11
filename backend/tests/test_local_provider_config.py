import runpy
import tempfile
import unittest
from pathlib import Path

class LocalProviderConfigTests(unittest.TestCase):
    def test_private_key_aliases_and_only_referenced_mcp_tokens(self):
        module=runpy.run_path(str(Path(__file__).resolve().parents[2]/'scripts/configure-local-agent.py'))
        settings=module['settings']
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'backend').mkdir()
            (root/'backend/.env').write_text('GLM_API_KEY=old\n')
            (root/'.env').write_text('GLM_API_KEY=new\nDEEPSEEK_API_KEY=private\nUNRELATED_PASSWORD=never-forward\nMCP_TOKEN=allowed\nIZGE_AGENT_MCP_CONNECTORS_JSON=[{"id":"company","token_env":"MCP_TOKEN"}]\n')
            settings.__globals__['ROOT']=root
            values=settings()
        self.assertEqual('new',values['IZGE_AGENT_GLM_API_KEY'])
        self.assertEqual('private',values['IZGE_AGENT_DEEPSEEK_API_KEY'])
        self.assertEqual('allowed',values['MCP_TOKEN'])
        self.assertNotIn('UNRELATED_PASSWORD',values)

if __name__=='__main__':unittest.main()
