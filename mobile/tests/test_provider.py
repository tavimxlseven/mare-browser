import unittest
from unittest.mock import Mock, patch
import provider


class ProviderTests(unittest.TestCase):
    def test_shared_spotify_links_have_one_canonical_identity(self):
        identifier = "p" * 22
        expected = (
            "playlist",
            identifier,
            "https://open.spotify.com/playlist/" + identifier,
        )
        for link in (
            "spotify:playlist:" + identifier,
            "https://open.spotify.com/playlist/" + identifier + "?si=shared",
            "https://open.spotify.com/intl-pt/playlist/" + identifier,
        ):
            self.assertEqual(provider.normalize_link(link), expected)

    def test_source_refusal_is_actionable(self):
        child = Mock(returncode=1)
        child.communicate.return_value = (
            b'{"event":"warning","message":"prove it isn\'t a bot; downloads refused"}',
            None,
        )
        with patch("provider.subprocess.Popen", return_value=child):
            with self.assertRaisesRegex(provider.PreparationError, "bloqueou a rede"):
                provider.cli(
                    ["download", "https://open.spotify.com/track/" + "a" * 22], 10
                )

    def test_import_rejects_arbitrary_urls_before_starting_cli(self):
        with patch("provider.cli") as cli:
            with self.assertRaises(ValueError):
                provider.collection("https://internal.example/secret")
            cli.assert_not_called()


if __name__ == "__main__":
    unittest.main()
