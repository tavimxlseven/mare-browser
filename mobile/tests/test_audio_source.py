import unittest

from audio_source import choose


class AudioSourceTests(unittest.TestCase):
    def test_accents_and_official_visualizers_do_not_hide_compatible_audio(self):
        item = self.candidate("Singer - Introducao (Áudio Oficial)")
        self.assertIs(choose([item], "Introdução", "Singer", 200), item)
        item = self.candidate("Singer - Song (Visualizer)")
        self.assertIs(choose([item], "Song", "Singer", 200), item)

    def test_japanese_subtitles_and_unspaced_titles_match(self):
        item = self.candidate("7!!『ラヴァーズ』中日字幕", uploader="Lyrics")
        item["duration"] = 222
        self.assertIs(choose([item], "ラヴァーズ", "7!!", 222), item)
        self.assertIsNone(choose([item], "カワキヲアメク", "7!!", 222))

    def test_first_compatible_result_is_the_fallback_when_lyrics_are_absent(self):
        import tempfile, sys
        from pathlib import Path
        from types import SimpleNamespace
        from unittest.mock import patch
        import audio_source

        requests = []

        class Downloader:
            def __init__(self, options):
                self.options = options

            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def extract_info(self, url, download=False):
                if url.startswith("https://www.youtube.com/watch"):
                    return {"url": url}
                if url.endswith("lyrics") or url.endswith("official audio"):
                    return {"entries": []}
                return {
                    "entries": [
                        dict(
                            id="wrongartist", title="Someone Else - Song", duration=200
                        ),
                        dict(
                            id="abcdefghijk",
                            title="Singer - Song (Official Music Video)",
                            duration=215,
                        ),
                        dict(id="otherresult", title="Singer - Song", duration=200),
                    ]
                }

            def download(self, urls):
                requests.extend(urls)
                Path(self.options["outtmpl"]).write_bytes(b"completed-audio")
            def sanitize_info(self, info):
                return info
            def download_with_info_file(self, path):
                import json
                self.download([json.loads(Path(path).read_text())["url"]])
                return 0

        with tempfile.TemporaryDirectory() as folder, patch.dict(
            sys.modules, {"yt_dlp": SimpleNamespace(YoutubeDL=Downloader)}
        ):
            result = audio_source.download(
                "a" * 22,
                folder,
                dict(title="Song", artist="Singer", duration_ms=200000),
            )
            self.assertTrue(result.is_file())
            self.assertEqual(requests, ["https://www.youtube.com/watch?v=abcdefghijk"])

    def candidate(self, title, **fields):
        return dict(id="abcdefghijk", title=title, duration=200, **fields)

    def test_metadata_editions_collaborators_and_bzrp_numbering(self):
        item = self.candidate("Blur - For Tomorrow (Official Audio)")
        self.assertIs(choose([item], "For Tomorrow - 2012 Remaster", "Blur", 200), item)
        item = self.candidate("QUEVEDO || BZRP Music Sessions #52 (Lyrics)")
        self.assertIs(choose([item], "Quevedo: Bzrp Music Sessions, Vol. 52/66", "Bizarrap, Quevedo", 200), item)
        item = self.candidate("KayBlack - Vai Por Mim (Lyrics)")
        self.assertIs(choose([item], "VAI POR MIM", "GDM, KayBlack, Mc Paiva ZS", 200), item)

    def test_distributor_alias_fallback_requires_nearly_identical_duration(self):
        item = self.candidate("Singer - Unreleased Song (Lyrics)")
        self.assertIsNone(choose([item], "Unreleased Song", "Distribution alias", 200, fallback=True))
        self.assertIs(choose([item], "Unreleased Song", "Distribution alias", 200, fallback=True, artist_fallback=True), item)
        self.assertIsNone(choose([item], "Unreleased Song", "Distribution alias", 0, fallback=True, artist_fallback=True))
        item["duration"] = 208
        self.assertIsNone(choose([item], "Unreleased Song", "Distribution alias", 200, fallback=True, artist_fallback=True))

    def test_specific_alias_title_allows_short_upload_padding_but_not_altered_audio(self):
        title='Meet Me in the Pale Moonlight'
        item=self.candidate('Singer - '+title)
        item['duration']=207
        self.assertIs(choose([item],title,'Distributor',202.536,True,True),item)
        item['title']+=' (432Hz)'
        self.assertIsNone(choose([item],title,'Distributor',202.536,True,True))

    def test_prefers_audio_and_checks_recording_duration(self):
        lyrics = self.candidate("Singer - Song (Lyrics)")
        audio = self.candidate("Singer - Song (Official Audio)")
        clip = self.candidate("Singer - Song (Official Music Video)")
        self.assertIs(choose([clip, lyrics, audio], "Song", "Singer", 200), audio)
        audio["duration"] = 500
        self.assertIs(choose([audio, lyrics], "Song", "Singer", 200), lyrics)

    def test_never_falls_back_to_a_clip_cover_or_live_recording(self):
        for edition in (
            "Music Video",
            "Official Video",
            "Cover",
            "Live",
            "Remix",
            "Karaoke",
        ):
            with self.subTest(edition=edition):
                self.assertIsNone(
                    choose(
                        [self.candidate(f"Singer - Song ({edition})")],
                        "Song",
                        "Singer",
                        200,
                    )
                )
        self.assertIsNone(
            choose(
                [self.candidate("Someone Else - Song (Lyrics)")], "Song", "Singer", 200
            )
        )

    def test_whole_word_markers_do_not_reject_believe_or_discover(self):
        item = self.candidate("Singer - Believe (Lyrics)")
        self.assertIs(choose([item], "Believe", "Singer", 200), item)
        self.assertIsNone(choose([item], "Lie", "Singer", 200))

    def test_explicit_editions_and_topic_releases_are_accepted(self):
        item = self.candidate("Song", uploader="Singer - Topic")
        self.assertIs(choose([item], "Song", "Singer", 200), item)
        live = self.candidate("Singer - Song (Live) (Official Audio)")
        self.assertIs(choose([live], "Song (Live)", "Singer", 200), live)
        parenthetical = self.candidate("Singer - (My) Song (Lyrics)")
        self.assertIs(
            choose([parenthetical], "(My) Song", "Singer", 200), parenthetical
        )


if __name__ == "__main__":
    unittest.main()
