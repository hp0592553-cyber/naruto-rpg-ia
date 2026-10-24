import unittest
from browser_actions.live_controller import normalize_composer_text, is_chat_composer

class ComposerTests(unittest.TestCase):
    def test_empty_slate_markers(self):
        self.assertEqual(normalize_composer_text("\ufeff\u200b\u2060\n"), "")
    def test_real_draft_preserved(self):
        self.assertEqual(normalize_composer_text("\ufeffmeu rascunho"), "meu rascunho")
    def test_portuguese_composer_label(self):
        self.assertTrue(is_chat_composer({"label":"Conversar em #Comandos","region":False}))
    def test_search_not_chat(self):
        self.assertFalse(is_chat_composer({"label":"Buscar servidor","region":False}))
